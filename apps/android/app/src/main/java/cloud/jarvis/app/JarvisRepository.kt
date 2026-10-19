package cloud.jarvis.app

import android.app.Application
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import androidx.lifecycle.*
import androidx.room.Room
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*

class JarvisApplication : Application() {
    lateinit var repository: JarvisRepository
    override fun onCreate() { super.onCreate(); repository = JarvisRepository(this) }
}
class JarvisRepository(private val app: Application) : DefaultLifecycleObserver {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val credentials = CredentialStore(app)
    val preferences = AppPreferences(app)
    private val cache = Room.databaseBuilder(app, CacheDatabase::class.java, "jarvis-cache").build().snapshots()
    val system = MutableStateFlow<JsonObject?>(null)
    val agents = MutableStateFlow<List<JsonObject>>(emptyList())
    val usage = MutableStateFlow<JsonObject?>(null)
    val today = MutableStateFlow<JsonObject?>(null)
    val detail = MutableStateFlow<JsonObject?>(null)
    val events = MutableStateFlow<List<JsonObject>>(emptyList())
    val agentUsage = MutableStateFlow<JsonObject?>(null)
    val error = MutableStateFlow<String?>(null)
    val paired = MutableStateFlow(false)
    val backgroundEnabled = MutableStateFlow(false)
    val savedAt = MutableStateFlow<Long?>(null)
    val range = MutableStateFlow("today")
    val deepLink = MutableStateFlow<String?>(null)
    private val notificationDispatcher = JarvisNotificationDispatcher(app)
    private var foreground = false
    private var page = "home"
    private var selectedAgent: String? = null
    private var refreshing = false
    val gateway = GatewayClient(scope, ::onEvent, { onConnected() }) { updated -> scope.launch { runCatching { credentials.save(updated) }.onFailure { error.value = "无法保存刷新后的会话" } } }
    val m2 = M2Repository(gateway, scope, cache, error)
    val account = AccountRepository(gateway, scope, error)
    private var knownDeviceId: String? = null
    init {
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        (app.getSystemService(ConnectivityManager::class.java)).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { scope.launch { gateway.networkChanged() } }
            override fun onLost(network: Network) { scope.launch { gateway.networkChanged() } }
        })
        scope.launch { runCatching {
            cache.all().forEach { s ->
                if(s.key.startsWith("m2-") || s.key.startsWith("m4-") || s.key == "m3-semantic-view") m2.restore(s)
                when (s.key) { "system" -> system.value = Json.parseToJsonElement(s.json).jsonObject; "agents" -> agents.value = Json.parseToJsonElement(s.json).jsonArray.map { it.jsonObject }; "today" -> today.value = Json.parseToJsonElement(s.json).jsonObject }
                savedAt.value = maxOf(savedAt.value ?: 0, s.savedAt)
            }
            credentials.load()?.let { knownDeviceId = it.deviceId; paired.value = true; gateway.connect(it) }
            backgroundEnabled.value = credentials.backgroundEnabled()
            if (foreground && backgroundEnabled.value && paired.value) startBackground()
        }.onFailure { error.value = "无法恢复本地凭据，请重新登录" } }
    }
    private fun startBackground() { runCatching { app.startForegroundService(Intent(app, ConnectionService::class.java)) }.onFailure { error.value = "无法启动后台连接：${it.message}" } }
    private fun onConnected() {
        refresh()
        scope.launch { runCatching { account.refreshNow() }.onFailure { error.value = friendlyError(it) } }
    }
    fun setBackground(enabled: Boolean) { scope.launch { runCatching { credentials.setBackground(enabled); backgroundEnabled.value = enabled; val service = Intent(app, ConnectionService::class.java); if (enabled) startBackground() else app.stopService(service) }.onFailure { error.value = friendlyError(it) } } }
    override fun onStart(owner: LifecycleOwner) { foreground = true; gateway.subscribe(page in listOf("home", "system")); gateway.networkChanged(); if (backgroundEnabled.value && paired.value) startBackground() }
    override fun onStop(owner: LifecycleOwner) { foreground = false; gateway.subscribe(false) }
    fun selectPage(value: String) { page = value; gateway.subscribe(foreground && value in listOf("home", "system")) }
    fun handleDeepLink(intent: Intent?) { deepLinkTarget(intent?.dataString)?.let { deepLink.value = it; error.value = null } }
    fun consumeDeepLink() { deepLink.value = null }
    fun login(server: String, username: String, password: String) { scope.launch {
        error.value = null
        runCatching {
            val device = knownDeviceId ?: credentials.deviceId().also { knownDeviceId = it }
            val auth = gateway.login(server.trim(), username.trim(), password, device)
            completeLogin(auth)
        }.onFailure { error.value = friendlyError(it) }
    } }

    fun register(server: String, username: String, password: String, confirmation: String) { scope.launch {
        error.value = null
        runCatching {
            val device = knownDeviceId ?: credentials.deviceId().also { knownDeviceId = it }
            val auth = gateway.register(server.trim(), username.trim(), password, confirmation, device)
            completeLogin(auth)
        }.onFailure { error.value = friendlyError(it) }
    } }

    fun acceptInvite(server: String, token: String, password: String) { scope.launch {
        error.value = null
        runCatching {
            val device = knownDeviceId ?: credentials.deviceId().also { knownDeviceId = it }
            val auth = gateway.acceptInvite(server.trim(), token, password, device)
            completeLogin(auth)
        }.onFailure { error.value = friendlyError(it) }
    } }

    suspend fun registrationOpen(server: String): Boolean = runCatching { gateway.registrationOpen(server) }.getOrDefault(false)

    private suspend fun completeLogin(auth: Credentials) {
        credentials.save(auth)
        knownDeviceId = auth.deviceId
        preferences.lastServer = auth.server
        preferences.lastUsername = auth.username ?: ""
        m2.reset(); account.clear(); cache.clear()
        system.value = null; agents.value = emptyList(); usage.value = null; today.value = null; savedAt.value = null
        paired.value = true
        gateway.connect(auth)
    }

    fun logout() { scope.launch {
        runCatching { gateway.logoutRemote() }
        runCatching { credentials.clear() }
        runCatching { cache.clear() }
        m2.reset(); account.clear()
        system.value = null; agents.value = emptyList(); usage.value = null; today.value = null
        savedAt.value = null; paired.value = false; error.value = null
    } }
    private suspend fun save(key: String, value: JsonElement) { val now = System.currentTimeMillis(); cache.put(Snapshot(key, value.toString(), now)); savedAt.value = now }
    private fun onEvent(topic: String, value: JsonElement) {
        m2.event(topic, value)
        when (topic) {
            "system.status.changed" -> { system.value = value.jsonObject; scope.launch { runCatching { save("system", value) }.onFailure { error.value = friendlyError(it) } } }
            "agent.status.changed" -> { val a = value.jsonObject; agents.value = (agents.value.filter { it["id"] != a["id"] } + a).sortedBy { it["name"].toString() }; scope.launch { runCatching { save("agents", JsonArray(agents.value)); selectedAgent?.let { loadAgent(it) } }.onFailure { error.value = friendlyError(it) } } }
            "network.public_ipv6.changed" -> refresh()
            "llm.usage.changed" -> { scope.launch { runCatching { loadUsage(); selectedAgent?.let { loadAgent(it) } }.onFailure { error.value = friendlyError(it) } } }
            "notification.created" -> scope.launch {
                runCatching {
                    val id = value.jsonObject["notification_id"]?.jsonPrimitive?.contentOrNull
                    m2.reloadNotifications().firstOrNull { it["id"]?.jsonPrimitive?.contentOrNull == id }?.let(notificationDispatcher::show)
                }.onFailure { error.value = friendlyError(it) }
            }
        }
    }
    fun refresh() { if (refreshing) return; scope.launch {
        refreshing = true
        try { system.value = gateway.request("system.status.get").jsonObject; save("system", system.value!!)
            agents.value = gateway.request("agent.list").jsonArray.map { it.jsonObject }; save("agents", JsonArray(agents.value))
            loadUsage(); selectedAgent?.let { loadAgent(it) }; m2.refresh(); error.value = null
        } catch (e: Exception) { error.value = friendlyError(e) } finally { refreshing = false }
    } }
    fun selectRange(value: String) { range.value = value; scope.launch { runCatching { loadUsage() }.onFailure { error.value = friendlyError(it) } } }
    private suspend fun loadUsage() {
        val selected = range.value
        val result = gateway.request("llm.usage.summary", buildJsonObject { put("range", selected); put("group_by", "provider") }).jsonObject
        if (range.value == selected) usage.value = result
        today.value = if (selected == "today") result else gateway.request("llm.usage.summary", buildJsonObject { put("range", "today") }).jsonObject
        save("today", today.value!!)
    }
    fun selectAgent(id: String?) { selectedAgent = id; detail.value = null; events.value = emptyList(); agentUsage.value = null; if (id != null) scope.launch { runCatching { loadAgent(id) }.onFailure { error.value = friendlyError(it) } } }
    private suspend fun loadAgent(id: String) {
        val d = gateway.request("agent.get", buildJsonObject { put("agent_id", id) }).jsonObject
        val e = gateway.get("/api/v1/agents/$id/events").jsonArray.map { it.jsonObject }
        val u = gateway.request("llm.usage.summary", buildJsonObject { put("range", "today"); put("agent_id", id) }).jsonObject
        if (selectedAgent == id) { detail.value = d; events.value = e; agentUsage.value = u }
    }
}
class JarvisViewModel(application: Application) : AndroidViewModel(application) { val repository = (application as JarvisApplication).repository }

/**
 * Parse a `jarvis://` deep link into a navigation target.
 *
 * Pure on purpose: the Activity only hands over `intent.dataString`, so the
 * notification -> target -> screen contract is unit tested on the JVM instead of
 * only being exercised on a device.
 */
internal fun deepLinkTarget(raw: String?): String? {
    if (raw.isNullOrBlank()) return null
    val uri = runCatching { java.net.URI(raw.trim()) }.getOrNull() ?: return null
    if (!"jarvis".equals(uri.scheme, ignoreCase = true)) return null
    val id = uri.path?.split('/')?.firstOrNull { it.isNotBlank() }
    return when (uri.host) {
        "home" -> "home"
        "conversation" -> id?.let { "conversation/$it" }
        "task" -> id?.let { "run/$it" }
        "workspace" -> id?.let { "workspace/$it" }
        "space" -> id?.let { "space/$it" }
        "app" -> id?.let { "app/$it" }
        "notification" -> id?.let { "notification/$it" }
        else -> null
    }
}

/**
 * Navigation target for a push notification. Kept next to the parser so a new
 * notification kind cannot silently fall through to a dead end.
 */
internal fun notificationTarget(kind: String, id: String, reference: String): String = when (kind) {
    "task_completed", "task_failed", "task_question" -> "jarvis://task/$reference"
    "question" -> "jarvis://conversation/$reference"
    // An approval's reference is the approval id, not a run.
    else -> "jarvis://notification/$id"
}

/**
 * Turn an RPC failure into something a person can read. The server speaks error
 * codes (`{"error":"not_found"}`); rendering that body verbatim, which is what
 * used to happen, shows JSON to the user and leaks the wire contract.
 */
internal fun friendlyError(error: Throwable?): String {
    val raw = error?.message?.trim().orEmpty()
    if (raw.isEmpty()) return "操作失败，请重试"
    val code = runCatching { Json.parseToJsonElement(raw).jsonObject["error"]?.jsonPrimitive?.contentOrNull }.getOrNull()
        ?: raw.takeIf { it.matches(Regex("^[a-z][a-z0-9_.:-]{0,80}$")) }
    if (code == null) return if (raw.startsWith("{")) "操作失败，请重试" else raw.take(160)
    if (code.startsWith("speech_upstream_")) return "语音识别服务返回错误（${code.removePrefix("speech_upstream_")}）"
    return when (code) {
        "not_found", "conversation_not_found", "agent_not_found", "run_not_found" -> "内容不存在或无权访问"
        "unauthorized", "invalid_session", "session_replayed", "user_login_required" -> "登录已过期，请重新登录"
        "forbidden", "origin_forbidden", "not_owner" -> "无权访问该内容"
        "hermes_not_configured" -> "Jarvis 尚未连接模型服务"
        "view_resource_required" -> "这个视图需要先选择具体对象"
        "validation_error" -> "请求格式不正确"
        "invalid_credentials" -> "用户名或密码不正确"
        "invalid_invite" -> "邀请无效或已过期"
        "registration_closed" -> "首次注册已完成，请返回登录或使用管理员邀请"
        "device_owned_by_another_user" -> "此设备已绑定其他账户"
        "admin_required" -> "需要管理员权限"
        "last_admin" -> "至少要保留一名管理员"
        "cannot_change_own_role" -> "不能修改自己的管理员身份"
        "admin_required_for_casaos" -> "只有 Jarvis 管理员可以连接 CasaOS"
        "casaos:unauthorized" , "invalid_casaos" -> "CasaOS 用户名或密码不正确"
        "not_configured" -> "该服务尚未配置"
        "user_not_found" -> "用户不存在"
        "app_not_found" -> "应用不存在或未安装"
        "credential_required" -> "需要先在应用里创建只读凭据"
        "integration_http_401", "integration_http_403" -> "凭据被应用拒绝，请重新创建只读凭据"
        "service_unavailable" -> "服务暂时不可用，请稍后重试"
        "speech_not_configured" -> "服务端尚未配置云端语音识别"
        "speech_timeout" -> "语音识别超时，请再说一次"
        "speech_unreachable" -> "语音识别服务暂时不可用，请检查 Whisper 服务"
        "speech_upstream_401", "speech_upstream_403" -> "语音识别服务拒绝了请求，请检查 API Key"
        "audio_too_short" -> "录音太短，请按住多说一会儿"
        "audio_too_large" -> "录音过长，请控制在 30 秒内"
        "invalid_audio_type" -> "录音格式不支持"
        "invalid_audio" -> "录音数据无效，请重试"
        "request_failed" -> "服务暂时不可用，请稍后重试"
        else -> "操作失败（$code）"
    }
}
