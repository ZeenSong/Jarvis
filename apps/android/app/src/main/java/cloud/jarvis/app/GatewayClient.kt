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

enum class ConnectionState { connecting, online, reconnecting, offline, unauthorized }
class GatewayClient(private val scope: CoroutineScope, private val onEvent: (String, JsonElement) -> Unit, private val onConnected: () -> Unit) {
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
    private val m2Topics = listOf("conversation.updated", "conversation.message.delta", "agent.run.created", "agent.run.updated", "resource.updated", "view.updated")
    private var topics = listOf("network.public_ipv6.changed", "agent.status.changed", "llm.usage.changed")

    suspend fun pair(server: String, code: String): Credentials = withContext(Dispatchers.IO) {
        val base = normalizeServer(server)
        val id = UUID.randomUUID().toString()
        val body = buildJsonObject { put("device_id", id); put("code", code) }.toString()
        http.newCall(Request.Builder().url("$base/api/v1/pair").post(body.toRequestBody("application/json".toMediaType())).build()).execute().use {
            check(it.isSuccessful) { "配对失败 (${it.code})，请检查一次性配对码" }
            Credentials(base, id, Json.parseToJsonElement(it.body!!.string()).jsonObject.getValue("token").jsonPrimitive.content)
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
        if (unauthorized) { mutableState.value = ConnectionState.unauthorized; return }
        mutableState.value = ConnectionState.reconnecting
        val wait = min(30_000L, 1000L shl min(retry++, 5)) + Random.nextLong(500)
        reconnectJob = scope.launch { delay(wait); open() }
    }
    suspend fun request(topic: String, payload: JsonObject = buildJsonObject {}): JsonElement {
        check(state.value == ConnectionState.online) { "尚未连接" }
        val id = UUID.randomUUID().toString(); val result = CompletableDeferred<JsonElement>(); pending[id] = result
        try {
            check(socket?.send(buildJsonObject { put("id", id); put("version", 1); put("type", "request"); put("topic", topic); put("payload", payload) }.toString()) == true)
            return withTimeout(10_000) { result.await() }
        } finally { pending.remove(id) }
    }
    suspend fun get(path: String): JsonElement = withContext(Dispatchers.IO) {
        val auth = credentials ?: error("尚未配对")
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
