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

enum class ConnectionState { connecting, online, reconnecting, offline, unauthorized }
class GatewayClient(private val scope: CoroutineScope, private val onEvent: (String, JsonElement) -> Unit, private val onConnected: () -> Unit, private val onCredentialsUpdated: (Credentials) -> Unit = {}) {
    private val http = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).pingInterval(15, TimeUnit.SECONDS).build()
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
    private val m2Topics = listOf("conversation.updated", "conversation.message.delta", "conversation.execution.updated", "conversation.result.updated", "conversation.question.created", "conversation.question.answered", "conversation.question.cancelled", "conversation.activity.started", "conversation.activity.waiting_approval", "conversation.activity.completed", "conversation.activity.failed", "conversation.activity.cancelled", "conversation.status", "task.created", "task.started", "task.waiting", "task.completed", "task.failed", "task.cancelled", "agent.run.created", "agent.run.updated", "resource.updated", "workspace.created", "workspace.updated", "workspace.artifact.updated", "approval.created", "approval.resolved", "notification.created")
    private var topics = listOf("network.public_ipv6.changed", "agent.status.changed", "llm.usage.changed")

    suspend fun login(server: String, username: String, password: String): Credentials = withContext(Dispatchers.IO) {
        val base = normalizeServer(server)
        val deviceId = UUID.randomUUID().toString()
        val body = buildJsonObject { put("username", username); put("password", password); put("device_id", deviceId) }.toString()
        http.newCall(Request.Builder().url("$base/api/v2/auth/login").post(body.toRequestBody("application/json".toMediaType())).build()).execute().use {
            check(it.isSuccessful) { "登录失败 (${it.code})" }
            val value = Json.parseToJsonElement(it.body!!.string()).jsonObject
            Credentials(base, deviceId, value.getValue("access_token").jsonPrimitive.content, value["refresh_token"]?.jsonPrimitive?.content)
        }
    }
    fun connect(value: Credentials) { credentials = value; retry = 0; open() }
    fun networkChanged() { if (credentials != null && mutableState.value != ConnectionState.unauthorized) open() }
    fun subscribe(highFrequency: Boolean) {
        topics = m2Topics + listOf("network.public_ipv6.changed", "agent.status.changed", "llm.usage.changed") + if (highFrequency) listOf("system.status.changed") else emptyList()
        if (state.value == ConnectionState.online) scope.launch { runCatching { request("gateway.subscribe", buildJsonObject { put("topics", JsonArray(topics.map(::JsonPrimitive))) }) } }
    }
    private fun open() {
        val auth = credentials ?: return
        val gen = ++generation
        reconnectJob?.cancel(); heartbeatJob?.cancel(); socket?.cancel()
        pending.values.forEach { it.completeExceptionally(IllegalStateException("连接已重置")) }; pending.clear()
        mutableState.value = if (retry == 0) ConnectionState.connecting else ConnectionState.reconnecting
        socket = http.newWebSocket(Request.Builder().url(auth.server.replaceFirst("http", "ws") + "/ws").header("Authorization", "Bearer ${auth.token}").build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { scope.launch {
                if (gen != generation) return@launch
                socket = webSocket; mutableState.value = ConnectionState.online
                subscribe(topics.contains("system.status.changed")); onConnected()
                heartbeatJob = scope.launch { while (isActive && gen == generation) {
                    val start = System.nanoTime()
                    try { request("gateway.ping"); latency.value = (System.nanoTime() - start) / 1_000_000; retry = 0 }
                    catch (_: Exception) { if (gen == generation) failed(gen, false); break }
                    delay(15_000)
                } }
            } }
            override fun onMessage(webSocket: WebSocket, text: String) { scope.launch {
                if (gen != generation) return@launch
                runCatching {
                    val m = Json.parseToJsonElement(text).jsonObject
                    val reply = m["reply_to"]?.jsonPrimitive?.content
                    if (reply != null) {
                        val deferred = pending.remove(reply)
                        if (m["type"]?.jsonPrimitive?.content == "error") deferred?.completeExceptionally(IllegalStateException(m["payload"].toString()))
                        else deferred?.complete(m["payload"] ?: JsonNull)
                    } else if (m["type"]?.jsonPrimitive?.content == "event") onEvent(m.getValue("topic").jsonPrimitive.content, m["payload"] ?: JsonNull)
                }
            } }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { scope.launch { failed(gen, response?.code == 401) } }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { scope.launch { failed(gen, false) } }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
        })
    }
    private fun failed(gen: Int, unauthorized: Boolean) {
        if (gen != generation) return
        generation++; socket?.cancel(); heartbeatJob?.cancel(); latency.value = null
        pending.values.forEach { it.completeExceptionally(IllegalStateException("连接中断")) }; pending.clear()
        if (unauthorized) {
            val refresh = credentials?.refreshToken
            if (refresh != null) { scope.launch { runCatching { refreshAccess(refresh) }.onFailure { mutableState.value = ConnectionState.unauthorized } } }
            else mutableState.value = ConnectionState.unauthorized
            return
        }
        mutableState.value = ConnectionState.reconnecting
        val wait = min(30_000L, 1000L shl min(retry++, 5)) + Random.nextLong(500)
        reconnectJob = scope.launch { delay(wait); open() }
    }
    private suspend fun refreshAccess(refresh: String) = withContext(Dispatchers.IO) {
        val auth = credentials ?: error("尚未连接")
        val body = buildJsonObject { put("refresh_token", refresh) }.toString()
        http.newCall(Request.Builder().url("${auth.server}/api/v2/auth/refresh").post(body.toRequestBody("application/json".toMediaType())).build()).execute().use {
            check(it.isSuccessful) { "会话已失效" }
            val value = Json.parseToJsonElement(it.body!!.string()).jsonObject
            val updated = auth.copy(token = value.getValue("access_token").jsonPrimitive.content, refreshToken = value.getValue("refresh_token").jsonPrimitive.content)
            credentials = updated; onCredentialsUpdated(updated); retry = 0; open()
        }
    }
    suspend fun request(topic: String, payload: JsonObject = buildJsonObject {}): JsonElement {
        check(state.value == ConnectionState.online) { "尚未连接" }
        val id = UUID.randomUUID().toString(); val result = CompletableDeferred<JsonElement>(); pending[id] = result
        try {
            check(socket?.send(buildJsonObject { put("id", id); put("version", 1); put("type", "request"); put("topic", topic); put("payload", payload) }.toString()) == true)
            return withTimeout(10_000) { result.await() }
        } finally { pending.remove(id) }
    }
    suspend fun thumbnail(path:String):ByteArray {
        require(cloud.jarvis.app.dynamicui.mediaPath.matches(path))
        return media(path)
    }
    suspend fun media(path:String):ByteArray = withContext(Dispatchers.IO) {
        val uri=URI(path)
        require(uri.scheme==null && uri.host==null && uri.fragment==null)
        val direct=Regex("^/api/media/[a-zA-Z0-9_-]{1,100}/(?:thumbnail|content)$").matches(uri.path)
        val legacy=if(uri.path=="/api/media/file" && uri.rawQuery?.startsWith("path=")==true && !uri.rawQuery!!.substringAfter("path=").contains('&')) {
            val decoded=URLDecoder.decode(uri.rawQuery!!.substringAfter("path="),"UTF-8")
            Regex("^/opt/data/[A-Za-z0-9._/-]+\\.(?:png|jpe?g|webp)$",RegexOption.IGNORE_CASE).matches(decoded)
        } else false
        require(direct || legacy)
        val auth=credentials ?: error("尚未登录")
        val client=http.newBuilder().followRedirects(false).followSslRedirects(false).build()
        client.newCall(Request.Builder().url(auth.server+path).header("Authorization","Bearer ${auth.token}").build()).execute().use { response ->
            check(response.isSuccessful) { "图片暂不可用" }
            check(response.header("Content-Type")?.substringBefore(';') in listOf("image/jpeg","image/png","image/webp")) { "图片格式不支持" }
            val body=response.body ?: error("图片暂不可用")
            body.byteStream().use { stream ->
                val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
                while(true) { val count=stream.read(buffer);if(count<0)break;check(output.size()+count<=2*1024*1024) { "图片过大" };output.write(buffer,0,count) }
                output.toByteArray()
            }
        }
    }
    suspend fun get(path: String): JsonElement = withContext(Dispatchers.IO) {
        val auth = credentials ?: error("尚未登录")
        http.newCall(Request.Builder().url(auth.server + path).header("Authorization", "Bearer ${auth.token}").build()).execute().use {
            check(it.isSuccessful) { "请求失败 (${it.code})" }; Json.parseToJsonElement(it.body!!.string())
        }
    }
    companion object {
        fun normalizeServer(value: String): String {
            val base = (if (value.contains("://")) value else "http://$value").trimEnd('/')
            val uri = java.net.URI(base)
            require(uri.scheme in listOf("http", "https") && uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path.isNullOrEmpty()) { "请输入 Tailscale 地址，例如 http://100.80.1.2:8080" }
            return base
        }
    }
}
