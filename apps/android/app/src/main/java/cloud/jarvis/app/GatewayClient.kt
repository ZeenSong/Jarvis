package cloud.jarvis.app

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random
import java.net.URI
import java.net.URLDecoder

private val baseGatewayTopics = listOf(
    "conversation.updated", "conversation.message.delta", "conversation.execution.updated",
    "conversation.result.updated", "conversation.question.created", "conversation.question.answered",
    "conversation.question.cancelled", "conversation.activity.started", "conversation.activity.waiting_approval",
    "conversation.activity.completed", "conversation.activity.failed", "conversation.activity.cancelled",
    "conversation.status", "approval.created", "approval.resolved", "notification.created",
    "resource.updated", "agent.run.updated", "task.created", "task.completed", "task.failed",
    "task.cancelled", "workspace.artifact.updated", "app.catalog.updated", "schedule.created",
)

/**
 * The server rejects a `gateway.subscribe` array larger than 32 entries. Keeping
 * this as one testable function prevents a future event from silently cutting
 * off the stream (which used to leave a finished reply stuck on "answering").
 */
internal fun gatewaySubscriptionTopics(highFrequency: Boolean): List<String> =
    baseGatewayTopics + listOf("network.public_ipv6.changed", "agent.status.changed", "llm.usage.changed") +
        if (highFrequency) listOf("system.status.changed") else emptyList()

enum class ConnectionState { connecting, online, reconnecting, offline, unauthorized }

/**
 * Authenticated transport for Jarvis.
 *
 * WebSocket RPC is the live path; a small set of account and integration
 * endpoints still live on HTTP (they predate the Gateway topics and are shared
 * with the Web client). Both paths use the same bearer session and the same
 * refresh-on-401 rule.
 */
class GatewayClient(
    private val scope: CoroutineScope,
    private val onEvent: (String, JsonElement) -> Unit,
    private val onConnected: () -> Unit,
    private val onCredentialsUpdated: (Credentials) -> Unit = {},
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .build()
    private val mutableState = MutableStateFlow(ConnectionState.offline)
    val state: StateFlow<ConnectionState> = mutableState
    val latency = MutableStateFlow<Long?>(null)
    private var credentials: Credentials? = null
    private var socket: WebSocket? = null
    private var generation = 0
    private var retry = 0
    private var reconnectJob: Job? = null
    private var heartbeatJob: Job? = null
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JsonElement>>()
    private var topics = gatewaySubscriptionTopics(false)

    val isOnline: Boolean get() = mutableState.value == ConnectionState.online
    fun currentCredentials(): Credentials? = credentials
    fun serverUrl(): String? = credentials?.server

    suspend fun registrationOpen(server: String): Boolean = withContext(Dispatchers.IO) {
        val base = normalizeServer(server)
        val (code, body) = executeHttp("GET", "$base/api/v2/auth/registration", null, null)
        code == 200 && runCatching { Json.parseToJsonElement(body).jsonObject["open"]?.jsonPrimitive?.booleanOrNull == true }.getOrDefault(false)
    }

    suspend fun login(server: String, username: String, password: String, deviceId: String? = null): Credentials = withContext(Dispatchers.IO) {
        val base = normalizeServer(server)
        val device = deviceId ?: UUID.randomUUID().toString()
        val body = buildJsonObject { put("username", username); put("password", password); put("device_id", device) }.toString()
        val (code, response) = executeHttp("POST", "$base/api/v2/auth/login", body, null)
        if (code !in 200..299) throw IllegalStateException(runCatching { Json.parseToJsonElement(response).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull() ?: "登录失败 (HTTP $code)")
        val value = Json.parseToJsonElement(response).jsonObject
        Credentials(base, device, value.getValue("access_token").jsonPrimitive.content, value["refresh_token"]?.jsonPrimitive?.contentOrNull, username)
    }

    suspend fun register(server: String, username: String, password: String, confirmation: String, deviceId: String? = null): Credentials = withContext(Dispatchers.IO) {
        if (password != confirmation) throw IllegalStateException("两次输入的密码不一致")
        val base = normalizeServer(server)
        val device = deviceId ?: UUID.randomUUID().toString()
        val body = buildJsonObject {
            put("username", username); put("password", password)
            put("password_confirmation", confirmation); put("device_id", device)
        }.toString()
        val (code, response) = executeHttp("POST", "$base/api/v2/auth/register", body, null)
        if (code !in 200..299) throw IllegalStateException(apiError(response, if (code == 409) "首次注册已完成，请返回登录或使用管理员邀请" else "注册失败，请检查用户名和密码"))
        val value = Json.parseToJsonElement(response).jsonObject
        Credentials(base, device, value.getValue("access_token").jsonPrimitive.content, value["refresh_token"]?.jsonPrimitive?.contentOrNull, username)
    }

    suspend fun acceptInvite(server: String, token: String, password: String, deviceId: String? = null): Credentials = withContext(Dispatchers.IO) {
        val base = normalizeServer(server)
        val accepted = executeHttp(
            "POST", "$base/api/v2/auth/invites/accept",
            buildJsonObject { put("token", token.trim()); put("password", password) }.toString(), null,
        )
        if (accepted.first !in 200..299) throw IllegalStateException(apiError(accepted.second, "邀请无效或已过期"))
        val username = runCatching { Json.parseToJsonElement(accepted.second).jsonObject["username"]?.jsonPrimitive?.contentOrNull }.getOrNull()
            ?: throw IllegalStateException("邀请已接受，但没有返回用户名")
        login(base, username, password, deviceId)
    }

    fun connect(value: Credentials) {
        credentials = value
        retry = 0
        open()
    }

    fun disconnect() {
        generation++
        reconnectJob?.cancel()
        heartbeatJob?.cancel()
        socket?.cancel()
        socket = null
        pending.values.forEach { it.completeExceptionally(IllegalStateException("连接已关闭")) }
        pending.clear()
        credentials = null
        latency.value = null
        mutableState.value = ConnectionState.offline
    }

    suspend fun logoutRemote() {
        val auth = credentials ?: return
        withContext(Dispatchers.IO) {
            runCatching { executeHttp("POST", "${auth.server}/api/v2/auth/logout", "{}", auth) }
        }
        disconnect()
    }

    fun networkChanged() {
        if (credentials != null && mutableState.value != ConnectionState.unauthorized) open()
    }

    fun subscribe(highFrequency: Boolean) {
        topics = gatewaySubscriptionTopics(highFrequency)
        if (state.value == ConnectionState.online) scope.launch {
            runCatching { request("gateway.subscribe", buildJsonObject { put("topics", JsonArray(topics.map(::JsonPrimitive))) }) }
        }
    }

    private fun open() {
        val auth = credentials ?: return
        val gen = ++generation
        reconnectJob?.cancel(); heartbeatJob?.cancel(); socket?.cancel()
        pending.values.forEach { it.completeExceptionally(IllegalStateException("连接已重置")) }; pending.clear()
        mutableState.value = if (retry == 0) ConnectionState.connecting else ConnectionState.reconnecting
        val httpUrl = auth.server.replaceFirst("http", "ws") + "/ws"
        socket = http.newWebSocket(
            Request.Builder().url(httpUrl).header("Authorization", "Bearer ${auth.token}").build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    scope.launch {
                        if (gen != generation) return@launch
                        socket = webSocket
                        mutableState.value = ConnectionState.online
                        subscribe(topics.contains("system.status.changed"))
                        onConnected()
                        heartbeatJob = scope.launch {
                            while (isActive && gen == generation) {
                                val start = System.nanoTime()
                                try {
                                    request("gateway.ping")
                                    latency.value = (System.nanoTime() - start) / 1_000_000
                                    retry = 0
                                } catch (_: Exception) {
                                    if (gen == generation) failed(gen, false)
                                    break
                                }
                                delay(15_000)
                            }
                        }
                    }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    scope.launch {
                        if (gen != generation) return@launch
                        runCatching {
                            val m = Json.parseToJsonElement(text).jsonObject
                            val reply = m["reply_to"]?.jsonPrimitive?.content
                            if (reply != null) {
                                val deferred = pending.remove(reply)
                                if (m["type"]?.jsonPrimitive?.content == "error") deferred?.completeExceptionally(IllegalStateException(m["payload"].toString()))
                                else deferred?.complete(m["payload"] ?: JsonNull)
                            } else if (m["type"]?.jsonPrimitive?.content == "event") {
                                onEvent(m.getValue("topic").jsonPrimitive.content, m["payload"] ?: JsonNull)
                            }
                        }
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    scope.launch { failed(gen, response?.code == 401) }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    scope.launch { failed(gen, false) }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, reason)
                }
            },
        )
    }

    private fun failed(gen: Int, unauthorized: Boolean) {
        if (gen != generation) return
        generation++; socket?.cancel(); heartbeatJob?.cancel(); latency.value = null
        pending.values.forEach { it.completeExceptionally(IllegalStateException("连接中断")) }; pending.clear()
        if (unauthorized) {
            val refresh = credentials?.refreshToken
            if (refresh != null) {
                scope.launch { runCatching { refreshAccess(refresh) }.onFailure { mutableState.value = ConnectionState.unauthorized } }
            } else mutableState.value = ConnectionState.unauthorized
            return
        }
        mutableState.value = ConnectionState.reconnecting
        val wait = min(30_000L, 1000L shl min(retry++, 5)) + Random.nextLong(500)
        reconnectJob = scope.launch { delay(wait); open() }
    }

    private suspend fun refreshAccess(refresh: String) = withContext(Dispatchers.IO) {
        val auth = credentials ?: error("尚未连接")
        val body = buildJsonObject { put("refresh_token", refresh) }.toString()
        val (code, response) = executeHttp("POST", "${auth.server}/api/v2/auth/refresh", body, null)
        check(code in 200..299) { "会话已失效" }
        val value = Json.parseToJsonElement(response).jsonObject
        val updated = auth.copy(
            token = value.getValue("access_token").jsonPrimitive.content,
            refreshToken = value.getValue("refresh_token").jsonPrimitive.content,
        )
        credentials = updated
        onCredentialsUpdated(updated)
        retry = 0
        open()
    }

    suspend fun request(topic: String, payload: JsonObject = buildJsonObject {}): JsonElement {
        check(state.value == ConnectionState.online) { "尚未连接" }
        val id = UUID.randomUUID().toString()
        val result = CompletableDeferred<JsonElement>()
        pending[id] = result
        try {
            check(socket?.send(buildJsonObject { put("id", id); put("version", 1); put("type", "request"); put("topic", topic); put("payload", payload) }.toString()) == true)
            return withTimeout(20_000) { result.await() }
        } finally {
            pending.remove(id)
        }
    }

    /** HTTP JSON request with bearer auth and one transparent session refresh. */
    suspend fun http(
        method: String,
        path: String,
        body: JsonObject? = null,
        readTimeoutSeconds: Long = 30,
    ): JsonElement = withContext(Dispatchers.IO) {
        val auth = credentials ?: throw IllegalStateException("尚未登录")
        val requestBody = body?.toString()
        val client = if (readTimeoutSeconds <= 30) http else http.newBuilder()
            .readTimeout(readTimeoutSeconds, TimeUnit.SECONDS)
            .build()
        var (code, response) = executeHttp(method, auth.server + path, requestBody, auth, client)
        if (code == 401 && auth.refreshToken != null) {
            refreshAccess(auth.refreshToken)
            val renewed = credentials ?: throw IllegalStateException("登录已过期，请重新登录")
            val retried = executeHttp(method, renewed.server + path, requestBody, renewed, client)
            code = retried.first
            response = retried.second
        }
        if (code !in 200..299) throw IllegalStateException(apiError(response, "请求失败 (HTTP $code)"))
        if (response.isBlank()) JsonNull else runCatching { Json.parseToJsonElement(response) }.getOrDefault(JsonNull)
    }

    /** Whether the server has a self-hosted Whisper endpoint configured. */
    suspend fun speechStatus(): JsonObject? = runCatching {
        http("GET", "/api/v2/speech/status").jsonObject
    }.getOrNull()

    /** Upload one conversation-scoped image and return its media resource. */
    suspend fun uploadMedia(conversationId: String, data: ByteArray, mimeType: String, filename: String): JsonObject {
        require(data.size in 1..2 * 1024 * 1024) { "media_too_large" }
        val encoded = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP)
        val payload = buildJsonObject {
            put("conversation_id", conversationId)
            put("data_base64", encoded)
            put("content_type", mimeType)
            put("filename", filename.take(120))
        }
        return http("POST", "/api/v2/media", payload, readTimeoutSeconds = 60).jsonObject
    }

    /** Upload a short WAV clip and return its transcript. */
    suspend fun transcribe(audio: ByteArray): String {
        require(audio.size in 1..8 * 1024 * 1024) { "audio_too_large" }
        val encoded = android.util.Base64.encodeToString(audio, android.util.Base64.NO_WRAP)
        val payload = buildJsonObject {
            put("audio_base64", encoded)
            put("mime_type", "audio/wav")
            put("language", "zh")
        }
        val result = http(
            "POST", "/api/v2/speech/transcribe", payload,
            readTimeoutSeconds = 120,
        ).jsonObject
        return (result["text"] as? JsonPrimitive)?.contentOrNull.orEmpty().trim()
    }

    fun webSessionCookie(): Pair<String, String>? {
        val auth = credentials ?: return null
        return auth.server to "jarvis_access=${auth.token}; Path=/; Max-Age=2592000"
    }

    suspend fun thumbnail(path: String): ByteArray {
        require(cloud.jarvis.app.dynamicui.mediaPath.matches(path))
        return media(path)
    }

    suspend fun media(path: String): ByteArray = withContext(Dispatchers.IO) {
        val uri = URI(path)
        require(uri.scheme == null && uri.host == null && uri.fragment == null)
        val direct = Regex("^/api/media/[a-zA-Z0-9_-]{1,100}/(?:thumbnail|content)$").matches(uri.path)
        val legacy = if (uri.path == "/api/media/file" && uri.rawQuery?.startsWith("path=") == true && !uri.rawQuery!!.substringAfter("path=").contains('&')) {
            val decoded = URLDecoder.decode(uri.rawQuery!!.substringAfter("path="), "UTF-8")
            Regex("^/opt/data/[A-Za-z0-9._/-]+\\.(?:png|jpe?g|webp)$", RegexOption.IGNORE_CASE).matches(decoded)
        } else false
        require(direct || legacy)
        val auth = credentials ?: error("尚未登录")
        val client = http.newBuilder().followRedirects(false).followSslRedirects(false).build()
        client.newCall(Request.Builder().url(auth.server + path).header("Authorization", "Bearer ${auth.token}").build()).execute().use { response ->
            check(response.isSuccessful) { "图片暂不可用" }
            check(response.header("Content-Type")?.substringBefore(';') in listOf("image/jpeg", "image/png", "image/webp")) { "图片格式不支持" }
            val body = response.body ?: error("图片暂不可用")
            body.byteStream().use { stream ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    check(output.size() + count <= 2 * 1024 * 1024) { "图片过大" }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
        }
    }

    suspend fun get(path: String): JsonElement = withContext(Dispatchers.IO) {
        val auth = credentials ?: error("尚未登录")
        http.newCall(Request.Builder().url(auth.server + path).header("Authorization", "Bearer ${auth.token}").build()).execute().use {
            check(it.isSuccessful) { "请求失败 (${it.code})" }
            Json.parseToJsonElement(it.body!!.string())
        }
    }

    private fun executeHttp(
        method: String,
        url: String,
        body: String?,
        auth: Credentials?,
        client: OkHttpClient = http,
    ): Pair<Int, String> {
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (auth != null) builder.header("Authorization", "Bearer ${auth.token}")
        val payload = body?.toRequestBody("application/json".toMediaType())
        when (method.uppercase()) {
            "POST" -> builder.post(payload ?: "".toRequestBody("application/json".toMediaType()))
            "PATCH" -> builder.patch(payload ?: "".toRequestBody("application/json".toMediaType()))
            "PUT" -> builder.put(payload ?: "".toRequestBody("application/json".toMediaType()))
            "DELETE" -> if (payload != null) builder.delete(payload) else builder.delete()
            else -> builder.get()
        }
        return try {
            client.newCall(builder.build()).execute().use { response ->
                response.code to (response.body?.string() ?: "")
            }
        } catch (error: Exception) {
            throw IllegalStateException("网络请求失败：${error.message ?: "请检查连接"}")
        }
    }

    private fun apiError(body: String, fallback: String): String {
        val code = runCatching { Json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull }.getOrNull()
        return friendlyHtmlFree(code ?: fallback)
    }

    private fun friendlyHtmlFree(value: String) = value.take(180)

    companion object {
        fun normalizeServer(value: String): String {
            val base = (if (value.contains("://")) value else "http://$value").trimEnd('/')
            val uri = java.net.URI(base)
            require(uri.scheme in listOf("http", "https") && uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path.isNullOrEmpty()) {
                "请输入 Tailscale 地址，例如 http://100.80.1.2:8080"
            }
            return base
        }
    }
}
