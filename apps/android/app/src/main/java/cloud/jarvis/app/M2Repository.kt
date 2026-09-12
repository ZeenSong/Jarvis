package cloud.jarvis.app

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import java.util.UUID

class M2Repository(private val gateway: GatewayClient, private val scope: CoroutineScope, private val cache: SnapshotDao, private val error: MutableStateFlow<String?>) {
    val semanticView = MutableStateFlow<JsonObject?>(null)
    suspend fun thumbnail(path:String)=gateway.thumbnail(path)
    val applications = MutableStateFlow<JsonObject?>(null)
    fun refreshApplications() { task { loadApplications() } }
    private suspend fun loadApplications() {
        applications.value = try { gateway.request("application.list").jsonObject }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { buildJsonObject { put("status", "unavailable"); put("apps", JsonArray(emptyList())) } }
    }
    val conversations = MutableStateFlow<List<JsonObject>>(emptyList())
    val conversation = MutableStateFlow<JsonObject?>(null)
    val hierarchy = MutableStateFlow<JsonObject?>(null)
    val view = MutableStateFlow<JsonObject?>(null)
    val resources = MutableStateFlow<Map<String, JsonObject>>(emptyMap())
    val sending = MutableStateFlow(false)
    private var selected: String? = null
    private var runId: String? = null
    private var viewGeneration = 0
    private var refreshing = false
    private var refreshAgain = false
    private var pending: JsonObject? = null
    private fun task(block: suspend () -> Unit) { scope.launch { runCatching { block() }.onFailure { error.value = it.message } } }
    suspend fun restore(s: Snapshot) {
        val value = Json.parseToJsonElement(s.json)
        when(s.key) {
            "m2-conversations" -> conversations.value = value.jsonArray.map { it.jsonObject }
            "m2-conversation" -> { conversation.value = value.jsonObject; selected = value.jsonObject["conversation"]?.jsonObject?.get("id")?.jsonPrimitive?.content }
            "m2-hierarchy" -> hierarchy.value = value.jsonObject
            "m2-view" -> view.value = value.jsonObject
            "m3-semantic-view" -> semanticView.value = (value as? JsonObject)?.takeIf { (it["ui_protocol"] as? JsonPrimitive)?.content == "2.0" && it["sections"] is JsonArray }
            "m2-pending" -> pending = value as? JsonObject
            else -> if(s.key.startsWith("m2-resource:")) accept(value.jsonObject, false)
        }
    }
    private suspend fun save(key: String, value: JsonElement) { cache.put(Snapshot(key, value.toString(), System.currentTimeMillis())) }
    suspend fun refresh() {
        if(refreshing) { refreshAgain = true; return }
        refreshing = true
        try { do {
            refreshAgain = false
            loadApplications()
            conversations.value = gateway.request("conversation.list").jsonArray.map { it.jsonObject }; save("m2-conversations", JsonArray(conversations.value))
            hierarchy.value = gateway.request("agent.definition.list").jsonObject; save("m2-hierarchy", hierarchy.value!!)
            selected?.let { loadConversation(it) }
            val spec = view.value
            if(spec != null) loadResources(spec)
            if (semanticView.value?.get("id")?.jsonPrimitive?.contentOrNull == "agent_run_analysis") {
                val source = semanticView.value?.get("sections")?.jsonArray
                    ?.mapNotNull { (it as? JsonObject)?.get("source")?.jsonPrimitive?.contentOrNull }
                    ?.firstOrNull { it.startsWith("agent-run/") }
                source?.let { show("agent_run_analysis", it, refreshingView = true) }
            }
        } while(refreshAgain) } finally { refreshing = false }
    }
    private suspend fun loadConversation(id: String) { val result = gateway.request("conversation.get", buildJsonObject { put("conversation_id",id) }).jsonObject; if(id == selected) { conversation.value = result; save("m2-conversation",result) } }
    fun selectConversation(id: String?) { selected = id; conversation.value = null; if(id != null) task { loadConversation(id) } }
    fun send(text: String) { if(text.isBlank() || sending.value) return; sending.value = true; task {
        try {
            var id = selected
            if(id == null) { val c = gateway.request("conversation.create", buildJsonObject { put("title", text.take(40)) }).jsonObject; id = c.getValue("id").jsonPrimitive.content; selected = id }
            val request = pending ?: buildJsonObject { put("conversation_id", id); put("content",text); put("idempotency_key",UUID.randomUUID().toString()) }
            check(request["content"]?.jsonPrimitive?.content == text && request["conversation_id"]?.jsonPrimitive?.content == id) { "上一条消息尚未确认，请重试原消息" }
            pending = request; save("m2-pending", request)
            gateway.request("conversation.message",request); pending = null; save("m2-pending",JsonNull); loadConversation(id!!)
        } finally { sending.value = false }
    } }
    private suspend fun accept(next: JsonObject, persist: Boolean = true) {
        if(next["version"]?.jsonPrimitive?.intOrNull != 1) return
        val name = next["resource"]?.jsonPrimitive?.content ?: return
        val revision = next["revision"]?.jsonPrimitive?.longOrNull ?: return
        val old = resources.value[name]?.get("revision")?.jsonPrimitive?.longOrNull ?: -1
        if(revision <= old) return
        resources.value = resources.value + (name to next)
        if(persist) save("m2-resource:$name",next)
    }
    private suspend fun loadResources(spec: JsonObject) {
        spec["blocks"]?.jsonArray?.mapNotNull { it.jsonObject["resource"]?.jsonPrimitive?.content }?.distinct()?.forEach { name -> accept(gateway.request("resource.get",buildJsonObject { put("resource",name) }).jsonObject) }
    }
    fun show(intent: String, resource: String? = null, refreshingView: Boolean = false) {
      val generation = ++viewGeneration
      task {
        if (!refreshingView) semanticView.value = null
        val semantic = runCatching { gateway.request("view.v2.get",buildJsonObject {
            put("intent",buildJsonObject { put("type","view.show");put("intent",intent);put("resources",JsonArray(listOfNotNull(resource).map(::JsonPrimitive))) })
            put("renderer",cloud.jarvis.app.dynamicui.mobileRenderer)
        }).jsonObject }.getOrNull()
        val result = gateway.request("view.show",buildJsonObject { put("type","view.show"); put("intent",intent); put("resources",JsonArray(listOfNotNull(resource).map(::JsonPrimitive))) }).jsonObject
        if(generation != viewGeneration) return@task
        semanticView.value = if(semantic?.get("kind")?.jsonPrimitive?.content == "view") semantic["view"] as? JsonObject else null
        save("m3-semantic-view",semanticView.value ?: JsonNull)
        view.value = result.getValue("spec").jsonObject; save("m2-view",view.value!!); loadResources(view.value!!)
    } }
    fun loadView(id: String) {
        val generation=++viewGeneration
        semanticView.value = null
        task {
            val result=gateway.request("view.get",buildJsonObject { put("view_id",id) }).jsonObject
            if(generation != viewGeneration) return@task
            save("m3-semantic-view",JsonNull)
            view.value=result.getValue("spec").jsonObject
            save("m2-view",view.value!!);loadResources(view.value!!)
        }
    }
    fun openRun(id: String) { runId = id; show("agent_run_analysis","agent-run/$id") }
    fun action(action: JsonObject) { task { gateway.request("ui.action.invoke",action); refresh() } }
    fun event(topic: String, value: JsonElement) {
        when(topic) {
            "resource.updated" -> task { accept(value.jsonObject) }
            "conversation.updated" -> task { refresh() }
            "conversation.message.delta" -> {
                val p = value.jsonObject
                if(p["conversation_id"]?.jsonPrimitive?.content == selected) {
                    val old = conversation.value ?: return
                    conversation.value = JsonObject(old + ("messages" to JsonArray(old["messages"]!!.jsonArray.map { msg ->
                        val m = msg.jsonObject
                        if(m["id"] == p["message_id"] && (m["revision"]?.jsonPrimitive?.longOrNull ?: 0) < (p["revision"]?.jsonPrimitive?.longOrNull ?: 0)) JsonObject(m + mapOf("content" to (p["content"] ?: JsonPrimitive("")), "revision" to p.getValue("revision"))) else m
                    })))
                }
            }
            "agent.run.updated", "agent.run.created" -> task { refresh() }
        }
    }
}
