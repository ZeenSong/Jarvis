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
    private var foreground = false
    private var page = "home"
    private var selectedAgent: String? = null
    private var refreshing = false
    val gateway = GatewayClient(scope, ::onEvent) { refresh() }
    val m2 = M2Repository(gateway, scope, cache, error)
    init {
        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        (app.getSystemService(ConnectivityManager::class.java)).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { scope.launch { gateway.networkChanged() } }
            override fun onLost(network: Network) { scope.launch { gateway.networkChanged() } }
        })
        scope.launch { runCatching {
            cache.all().forEach { s ->
                if(s.key.startsWith("m2-")) m2.restore(s)
                when (s.key) { "system" -> system.value = Json.parseToJsonElement(s.json).jsonObject; "agents" -> agents.value = Json.parseToJsonElement(s.json).jsonArray.map { it.jsonObject }; "today" -> today.value = Json.parseToJsonElement(s.json).jsonObject }
                savedAt.value = maxOf(savedAt.value ?: 0, s.savedAt)
            }
            credentials.load()?.let { paired.value = true; gateway.connect(it) }
            backgroundEnabled.value = credentials.backgroundEnabled()
            if (foreground && backgroundEnabled.value && paired.value) startBackground()
        }.onFailure { error.value = "无法恢复本地凭据，请重新配对" } }
    }
    private fun startBackground() { runCatching { app.startForegroundService(Intent(app, ConnectionService::class.java)) }.onFailure { error.value = "无法启动后台连接：${it.message}" } }
    fun setBackground(enabled: Boolean) { scope.launch { runCatching { credentials.setBackground(enabled); backgroundEnabled.value = enabled; val service = Intent(app, ConnectionService::class.java); if (enabled) startBackground() else app.stopService(service) }.onFailure { error.value = it.message } } }
    override fun onStart(owner: LifecycleOwner) { foreground = true; gateway.subscribe(page in listOf("home", "server")); gateway.networkChanged(); if (backgroundEnabled.value && paired.value) startBackground() }
    override fun onStop(owner: LifecycleOwner) { foreground = false; gateway.subscribe(false) }
    fun selectPage(value: String) { page = value; gateway.subscribe(foreground && value in listOf("home", "server")) }
    fun pair(server: String, code: String) { scope.launch {
        error.value = null
        runCatching { val auth = gateway.pair(server.trim(), code.trim()); credentials.save(auth); cache.clear(); system.value = null; agents.value = emptyList(); usage.value = null; today.value = null; savedAt.value = null; paired.value = true; gateway.connect(auth) }.onFailure { error.value = it.message }
    } }
    private suspend fun save(key: String, value: JsonElement) { val now = System.currentTimeMillis(); cache.put(Snapshot(key, value.toString(), now)); savedAt.value = now }
    private fun onEvent(topic: String, value: JsonElement) {
        m2.event(topic, value)
        when (topic) {
            "system.status.changed" -> { system.value = value.jsonObject; scope.launch { runCatching { save("system", value) }.onFailure { error.value = it.message } } }
            "agent.status.changed" -> { val a = value.jsonObject; agents.value = (agents.value.filter { it["id"] != a["id"] } + a).sortedBy { it["name"].toString() }; scope.launch { runCatching { save("agents", JsonArray(agents.value)); selectedAgent?.let { loadAgent(it) } }.onFailure { error.value = it.message } } }
            "network.public_ipv6.changed" -> refresh()
            "llm.usage.changed" -> { scope.launch { runCatching { loadUsage(); selectedAgent?.let { loadAgent(it) } }.onFailure { error.value = it.message } } }
        }
    }
    fun refresh() { if (refreshing) return; scope.launch {
        refreshing = true
        try { system.value = gateway.request("system.status.get").jsonObject; save("system", system.value!!)
            agents.value = gateway.request("agent.list").jsonArray.map { it.jsonObject }; save("agents", JsonArray(agents.value))
            loadUsage(); selectedAgent?.let { loadAgent(it) }; m2.refresh(); error.value = null
        } catch (e: Exception) { error.value = e.message } finally { refreshing = false }
    } }
    fun selectRange(value: String) { range.value = value; scope.launch { runCatching { loadUsage() }.onFailure { error.value = it.message } } }
    private suspend fun loadUsage() {
        val selected = range.value
        val result = gateway.request("llm.usage.summary", buildJsonObject { put("range", selected); put("group_by", "provider") }).jsonObject
        if (range.value == selected) usage.value = result
        today.value = if (selected == "today") result else gateway.request("llm.usage.summary", buildJsonObject { put("range", "today") }).jsonObject
        save("today", today.value!!)
    }
    fun selectAgent(id: String?) { selectedAgent = id; detail.value = null; events.value = emptyList(); agentUsage.value = null; if (id != null) scope.launch { runCatching { loadAgent(id) }.onFailure { error.value = it.message } } }
    private suspend fun loadAgent(id: String) {
        val d = gateway.request("agent.get", buildJsonObject { put("agent_id", id) }).jsonObject
        val e = gateway.get("/api/v1/agents/$id/events").jsonArray.map { it.jsonObject }
        val u = gateway.request("llm.usage.summary", buildJsonObject { put("range", "today"); put("agent_id", id) }).jsonObject
        if (selectedAgent == id) { detail.value = d; events.value = e; agentUsage.value = u }
    }
}
class JarvisViewModel(application: Application) : AndroidViewModel(application) { val repository = (application as JarvisApplication).repository }
