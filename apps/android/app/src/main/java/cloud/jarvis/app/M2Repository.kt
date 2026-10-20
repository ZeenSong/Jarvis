package cloud.jarvis.app

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import java.util.UUID
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * A reply that is still streaming. The server already owns the durable message;
 * this mirror exists so the UI can render tokens before the next snapshot and so
 * the voice call can speak sentences as they arrive.
 */
data class LiveReply(
    val conversationId: String,
    val turnId: String,
    val messageId: String,
    val content: String = "",
    val status: String = "queued",
) {
    val finished: Boolean get() = status in listOf("completed", "failed", "cancelled")
}

class M2Repository(
    private val gateway: GatewayClient,
    private val scope: CoroutineScope,
    private val cache: SnapshotDao,
    private val error: MutableStateFlow<String?>,
) {
    val semanticView = MutableStateFlow<JsonObject?>(null)
    val applications = MutableStateFlow<JsonObject?>(null)
    val catalog = MutableStateFlow<JsonObject?>(null)
    val notifications = MutableStateFlow<List<JsonObject>>(emptyList())
    val approvals = MutableStateFlow<List<JsonObject>>(emptyList())
    val schedules = MutableStateFlow<List<JsonObject>>(emptyList())
    val composerOptions = MutableStateFlow<JsonObject?>(null)
    val conversations = MutableStateFlow<List<JsonObject>>(emptyList())
    val conversation = MutableStateFlow<JsonObject?>(null)
    val selectedConversationId = MutableStateFlow<String?>(null)
    val hierarchy = MutableStateFlow<JsonObject?>(null)
    val view = MutableStateFlow<JsonObject?>(null)
    val resources = MutableStateFlow<Map<String, JsonObject>>(emptyMap())
    val sending = MutableStateFlow(false)
    val liveReply = MutableStateFlow<LiveReply?>(null)
    val workspaces = MutableStateFlow<List<JsonObject>>(emptyList())
    val workspace = MutableStateFlow<JsonObject?>(null)
    val workspaceBusy = MutableStateFlow(false)
    val toolStates = MutableStateFlow<Map<String, Map<String, String>>>(emptyMap())
    val draft = MutableStateFlow("")

    private var selected: String? = null
    private var pendingWorkspaceId: String? = null
    private var viewGeneration = 0
    private var refreshing = false
    private var refreshAgain = false
    private var pending: JsonObject? = null

    fun selectedId(): String? = selected
    suspend fun thumbnail(path: String) = gateway.thumbnail(path)
    suspend fun media(path: String) = gateway.media(path)
    suspend fun speechStatus(): JsonObject? = gateway.speechStatus()
    suspend fun transcribe(audio: ByteArray): String = gateway.transcribe(audio)

    private fun task(block: suspend () -> Unit) {
        scope.launch { runCatching { block() }.onFailure { error.value = friendlyError(it) } }
    }

    fun reportError(message: String) { error.value = message }

    fun askAboutApp(name: String) { draft.value = "请读取并总结 $name 当前状态，同时告诉我下一步可以做什么。" }
    fun prefill(text: String) { draft.value = text }
    fun clearDraft() { draft.value = "" }

    fun reset() {
        viewGeneration++
        selected = null
        pendingWorkspaceId = null
        pending = null
        selectedConversationId.value = null
        conversations.value = emptyList(); conversation.value = null; hierarchy.value = null
        view.value = null; semanticView.value = null; resources.value = emptyMap()
        applications.value = null; catalog.value = null
        notifications.value = emptyList(); approvals.value = emptyList(); schedules.value = emptyList()
        composerOptions.value = null; workspaces.value = emptyList(); workspace.value = null
        toolStates.value = emptyMap(); draft.value = ""; sending.value = false; liveReply.value = null
    }

    suspend fun restore(s: Snapshot) {
        val value = Json.parseToJsonElement(s.json)
        when (s.key) {
            "m2-conversations" -> conversations.value = value.jsonArray.map { it.jsonObject }
            "m2-conversation" -> {
                conversation.value = value as? JsonObject
                selected = (value as? JsonObject)?.get("conversation")?.jsonObject?.str("id")
                selectedConversationId.value = selected
            }
            "m2-hierarchy" -> hierarchy.value = value as? JsonObject
            "m2-view" -> view.value = value as? JsonObject
            "m3-semantic-view" -> semanticView.value = (value as? JsonObject)?.takeIf { it.str("ui_protocol") == "2.0" && it["sections"] is JsonArray }
            "m2-pending" -> pending = value as? JsonObject
            "m4-notifications" -> notifications.value = value.jsonArray.map { it.jsonObject }
            else -> if (s.key.startsWith("m2-resource:")) accept(value.jsonObject, false)
        }
    }

    private suspend fun save(key: String, value: JsonElement) {
        cache.put(Snapshot(key, value.toString(), System.currentTimeMillis()))
    }

    suspend fun refresh() {
        if (refreshing) { refreshAgain = true; return }
        refreshing = true
        try {
            do {
                refreshAgain = false
                loadApplications()
                loadControlPlane()
                conversations.value = gateway.request("conversation.list").jsonArray.map { it.jsonObject }
                save("m2-conversations", JsonArray(conversations.value))
                hierarchy.value = gateway.request("agent.definition.list").jsonObject
                save("m2-hierarchy", hierarchy.value!!)
                selected?.let { loadConversation(it) }
                view.value?.let { loadResources(it) }
                if (semanticView.value?.str("id") == "agent_run_analysis") {
                    val source = semanticView.value?.get("sections")?.jsonArray
                        ?.mapNotNull { (it as? JsonObject)?.str("source") }
                        ?.firstOrNull { it.startsWith("agent-run/") }
                    source?.let { show("agent_run_analysis", it, refreshingView = true) }
                }
            } while (refreshAgain)
        } finally {
            refreshing = false
        }
    }

    fun refreshApplications() { task { loadApplications() } }

    private suspend fun loadApplications() {
        applications.value = runCatching { gateway.request("application.list").jsonObject }
            .getOrElse {
                buildJsonObject { put("status", "unavailable"); put("apps", JsonArray(emptyList())) }
            }
        catalog.value = runCatching { gateway.request("app.catalog").jsonObject }.getOrNull() ?: catalog.value
    }

    private suspend fun loadControlPlane() {
        runCatching { reloadNotifications() }
        runCatching { approvals.value = gateway.request("approval.list").jsonArray.map { it.jsonObject } }
        runCatching { schedules.value = gateway.request("schedule.list").jsonArray.map { it.jsonObject } }
        runCatching { composerOptions.value = gateway.request("conversation.composer.options").jsonObject }
    }

    suspend fun reloadNotifications(): List<JsonObject> {
        val result = gateway.request("notification.list").jsonArray.map { it.jsonObject }
        notifications.value = result
        save("m4-notifications", JsonArray(result))
        return result
    }

    suspend fun refreshConversationList() {
        conversations.value = gateway.request("conversation.list").jsonArray.map { it.jsonObject }
        save("m2-conversations", JsonArray(conversations.value))
    }

    private suspend fun loadConversation(id: String, developer: Boolean = false) {
        val payload = buildJsonObject {
            put("conversation_id", id)
            if (developer) put("developer", true)
        }
        val result = gateway.request("conversation.get", payload).jsonObject
        if (id == selected) {
            conversation.value = result
            save("m2-conversation", result)
            result["results"]?.jsonArray?.mapNotNull { (it as? JsonObject)?.get("view") as? JsonObject }?.forEach { loadSemanticResources(it) }
        }
    }

    fun selectConversation(id: String?) {
        selected = id
        selectedConversationId.value = id
        conversation.value = null
        liveReply.value = null
        if (id != null) task { loadConversation(id) }
    }

    fun newConversation() {
        selected = null
        selectedConversationId.value = null
        conversation.value = null
        liveReply.value = null
    }

    fun deleteConversation(id: String) { task {
        gateway.request("conversation.delete", buildJsonObject { put("conversation_id", id) })
        if (selected == id) newConversation()
        refreshConversationList()
    } }

    /**
     * Send one turn and return the server's accepted ids. The caller owns the
     * "sending" indicator so voice and text share exactly the same path.
     */
    suspend fun submit(
        text: String,
        reasoningEffort: String? = null,
        skills: Set<String> = emptySet(),
        conversationId: String? = null,
        allowPendingRetry: Boolean = true,
    ): JsonObject {
        var id = conversationId ?: selected
        if (id == null) {
            val conversation = gateway.request("conversation.create", buildJsonObject { put("title", "新会话") }).jsonObject
            id = conversation.getValue("id").jsonPrimitive.content
        }
        selected = id
        selectedConversationId.value = id
        val retry = if (allowPendingRetry) pending else null
        val request = if (retry != null && retry.str("content") == text && retry.str("conversation_id") == id) {
            retry
        } else {
            buildJsonObject {
                put("conversation_id", id)
                put("content", text)
                put("idempotency_key", UUID.randomUUID().toString())
                reasoningEffort?.let { put("reasoning_effort", it) }
                if (skills.isNotEmpty()) put("skills", JsonArray(skills.sorted().map(::JsonPrimitive)))
            }
        }
        pending = request
        save("m2-pending", request)
        val accepted = gateway.request("conversation.message", request).jsonObject
        pending = null
        save("m2-pending", JsonNull)
        val replyId = accepted.str("reply_id")
        val turnId = accepted.str("turn_id")
        if (replyId.isNotBlank()) {
            liveReply.value = LiveReply(id, turnId, replyId, "", "queued")
        }
        loadConversation(id)
        refreshConversationList()
        return accepted
    }

    fun send(text: String, reasoningEffort: String? = null, skills: Set<String> = emptySet()) {
        if (text.isBlank() || sending.value) return
        sending.value = true
        task {
            try { submit(text, reasoningEffort, skills) }
            finally { sending.value = false }
        }
    }

    /**
     * Upload an image, attach it to the conversation as a MEDIA_RESOURCE marker,
     * then submit the normal text turn. The marker is rendered by both clients
     * and resolved by the server into a multimodal description before Hermes.
     */
    fun sendImage(
        bytes: ByteArray,
        mimeType: String,
        filename: String,
        text: String,
        reasoningEffort: String? = null,
        skills: Set<String> = emptySet(),
    ) {
        if (sending.value) return
        sending.value = true
        task {
            try {
                var id = selected
                if (id == null) {
                    val conversation = gateway.request("conversation.create", buildJsonObject { put("title", "新会话") }).jsonObject
                    id = conversation.getValue("id").jsonPrimitive.content
                    selected = id
                    selectedConversationId.value = id
                }
                val media = gateway.uploadMedia(id, bytes, mimeType, filename)
                val marker = "MEDIA_RESOURCE:${media.getValue("id").jsonPrimitive.content}"
                val content = if (text.isBlank()) marker else "$marker\n$text"
                submit(content, reasoningEffort, skills, conversationId = id)
            } finally {
                sending.value = false
            }
        }
    }
    /**
     * Reconcile a streaming reply from the durable conversation. This is the
     * safety net for a missed event (and the recovery path for voice calls).
     */
    suspend fun syncLiveReply(conversationId: String, messageId: String): LiveReply? {
        val result = gateway.request("conversation.get", buildJsonObject { put("conversation_id", conversationId) }).jsonObject
        if (selected != conversationId) {
            selected = conversationId
            selectedConversationId.value = conversationId
        }
        conversation.value = result
        save("m2-conversation", result)
        val message = result.objects("messages").firstOrNull { it.str("id") == messageId } ?: return null
        val reply = LiveReply(
            conversationId = conversationId,
            turnId = message.str("turn_id"),
            messageId = messageId,
            content = message.str("content"),
            status = message.str("status").ifBlank { "streaming" },
        )
        liveReply.value = reply
        return reply
    }

    fun stop(turnId: String) { task {
        gateway.request("conversation.stop", buildJsonObject { put("turn_id", turnId) })
        liveReply.value?.takeIf { it.turnId == turnId }?.let { liveReply.value = it.copy(status = "cancelled") }
        selected?.let { loadConversation(it) }
    } }

    fun answerQuestion(questionId: String, answer: JsonElement) { task {
        gateway.request("conversation.question.answer", buildJsonObject { put("question_id", questionId); put("answer", answer) })
        selected?.let { loadConversation(it) }
        loadControlPlane()
    } }

    fun resolveApproval(approvalId: String, approved: Boolean) { task {
        gateway.request("approval.resolve", buildJsonObject { put("approval_id", approvalId); put("status", if (approved) "approved" else "rejected") })
        selected?.let { loadConversation(it) }
        loadControlPlane()
    } }

    fun markNotificationRead(id: String) { task {
        gateway.request("notification.read", buildJsonObject { put("notification_id", id) })
        loadControlPlane()
    } }

    fun cancelTask(id: String) { task { gateway.request("task.cancel", buildJsonObject { put("task_id", id) }); refresh() } }

    fun createSchedule(prompt: String, cadence: String, nextRunAt: String) { task {
        gateway.request("schedule.create", buildJsonObject {
            put("prompt", prompt); put("cadence", cadence); put("next_run_at", nextRunAt)
        })
        loadControlPlane()
    } }

    fun toggleSchedule(id: String, enabled: Boolean) { task {
        gateway.request("schedule.toggle", buildJsonObject { put("schedule_id", id); put("enabled", enabled) })
        loadControlPlane()
    } }

    fun deleteSchedule(id: String) { task {
        gateway.request("schedule.delete", buildJsonObject { put("schedule_id", id) })
        loadControlPlane()
    } }

    private suspend fun accept(next: JsonObject, persist: Boolean = true) {
        if (next["version"]?.jsonPrimitive?.intOrNull != 1) return
        val name = next.str("resource").ifBlank { return }
        val revision = next["revision"]?.jsonPrimitive?.longOrNull ?: return
        val old = resources.value[name]?.long("revision") ?: -1
        if (revision <= old) return
        resources.value = resources.value + (name to next)
        if (persist) save("m2-resource:$name", next)
    }

    private suspend fun loadResources(spec: JsonObject) {
        spec["blocks"]?.jsonArray
            ?.mapNotNull { (it as? JsonObject)?.str("resource")?.ifBlank { null } }
            ?.distinct()
            ?.forEach { name ->
                runCatching { accept(gateway.request("resource.get", buildJsonObject { put("resource", name) }).jsonObject) }
            }
    }

    private suspend fun loadSemanticResources(view: JsonObject) {
        view["sections"]?.jsonArray
            ?.mapNotNull { (it as? JsonObject)?.str("source")?.ifBlank { null } }
            ?.distinct()
            ?.forEach { name ->
                runCatching { accept(gateway.request("resource.get", buildJsonObject { put("resource", name) }).jsonObject) }
            }
    }

    fun show(intent: String, resource: String? = null, refreshingView: Boolean = false) {
        val generation = ++viewGeneration
        task {
            if (!refreshingView) semanticView.value = null
            val resourcesPayload = JsonArray(listOfNotNull(resource).map(::JsonPrimitive))
            val semantic = runCatching {
                gateway.request(
                    "view.v2.get",
                    buildJsonObject {
                        put("intent", buildJsonObject {
                            put("type", "view.show"); put("intent", intent); put("resources", resourcesPayload)
                        })
                        put("renderer", cloud.jarvis.app.dynamicui.mobileRenderer)
                    },
                ).jsonObject
            }.getOrNull()
            if (generation != viewGeneration) return@task
            if (semantic?.str("kind") == "view" && semantic["view"] is JsonObject) {
                semanticView.value = semantic["view"] as JsonObject
                view.value = null
                save("m3-semantic-view", semanticView.value!!)
                save("m2-view", JsonNull)
                loadSemanticResources(semanticView.value!!)
                return@task
            }
            val result = gateway.request(
                "view.show",
                buildJsonObject {
                    put("type", "view.show"); put("intent", intent); put("resources", resourcesPayload)
                },
            ).jsonObject
            if (generation != viewGeneration) return@task
            semanticView.value = null
            save("m3-semantic-view", JsonNull)
            view.value = result["spec"]?.let { it as? JsonObject }
            view.value?.let { save("m2-view", it); loadResources(it) }
        }
    }

    fun loadView(id: String) {
        val generation = ++viewGeneration
        semanticView.value = null
        task {
            val result = gateway.request("view.get", buildJsonObject { put("view_id", id) }).jsonObject
            if (generation != viewGeneration) return@task
            save("m3-semantic-view", JsonNull)
            view.value = result["spec"] as? JsonObject
            view.value?.let { save("m2-view", it); loadResources(it) }
        }
    }

    fun openRun(id: String) { show("agent_run_analysis", "agent-run/$id") }

    fun action(action: JsonObject) { task { gateway.request("ui.action.invoke", action); refresh() } }

    /** Invoke an action and return the raw result so callers can follow `app.open` links. */
    suspend fun invokeAction(action: JsonObject): JsonObject? =
        runCatching { gateway.request("ui.action.invoke", action) as? JsonObject }.getOrNull()

    fun openApp(id: String, context: Context) { task {
        val result = gateway.request("app.resolve", buildJsonObject { put("app_id", id); put("platform", "android") }).jsonObject
        val link = (result["link"] as? JsonObject)?.str("primary")?.ifBlank { null }
            ?: (result["link"] as? JsonObject)?.str("fallback")?.ifBlank { null }
        if (link != null) {
            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                .onFailure { error.value = "没有可以打开该应用的程序" }
        } else error.value = "该应用尚未配置可用链接"
    } }

    fun openWorkspace(workspaceId: String? = null) {
        if (workspaceId != null) pendingWorkspaceId = workspaceId
        selected?.let { id ->
            task {
                val list = gateway.request("workspace.list", buildJsonObject { put("conversation_id", id) }).jsonArray.map { it.jsonObject }
                if (selected != id) return@task
                workspaces.value = list
                val target = pendingWorkspaceId ?: list.firstOrNull()?.str("id")
                val result = target?.let { gateway.request("workspace.get", buildJsonObject { put("workspace_id", it) }).jsonObject }
                if (selected != id) return@task
                workspace.value = result
                pendingWorkspaceId = null
                result?.let { applyWorkspaceView(it) }
            }
        }
    }

    private suspend fun applyWorkspaceView(result: JsonObject) {
        val artifact = result["artifacts"]?.jsonArray?.mapNotNull { it as? JsonObject }
            ?.firstOrNull { it.str("type") == "native" } ?: return
        val spec = runCatching { Json.parseToJsonElement(artifact.str("source")).jsonObject }.getOrNull() ?: return
        viewGeneration++
        if (spec.str("ui_protocol") == "2.0") {
            semanticView.value = spec
            view.value = null
            save("m3-semantic-view", spec)
            save("m2-view", JsonNull)
            loadSemanticResources(spec)
        } else if (spec["version"]?.jsonPrimitive?.intOrNull == 1) {
            semanticView.value = null
            view.value = spec
            save("m3-semantic-view", JsonNull)
            save("m2-view", spec)
            loadResources(spec)
        }
    }

    fun openWorkspaceById(workspaceId: String) { task {
        val result = gateway.request("workspace.get", buildJsonObject { put("workspace_id", workspaceId) }).jsonObject
        workspace.value = result
        applyWorkspaceView(result)
    } }

    fun createWorkspace() { selected?.let { id -> task {
        workspaceBusy.value = true
        try {
            val value = gateway.request("workspace.create", buildJsonObject {
                put("conversation_id", id); put("type", "native"); put("title", "Jarvis 工作区")
            }).jsonObject
            val workspaceId = (value["workspace"] as? JsonObject)?.str("id")?.ifBlank { null } ?: value.str("id")
            workspace.value = gateway.request("workspace.get", buildJsonObject { put("workspace_id", workspaceId) }).jsonObject
            openWorkspace(workspaceId)
        } finally { workspaceBusy.value = false }
    } } }

    fun saveArtifact(workspaceId: String, artifactId: String?, source: String) { task {
        workspaceBusy.value = true
        try {
            gateway.request("workspace.artifact.upsert", buildJsonObject {
                put("workspace_id", workspaceId)
                artifactId?.let { put("artifact_id", it) }
                put("type", "html"); put("media_type", "text/html")
                put("source", source); put("compiled", source); put("status", "ready")
            })
            workspace.value = gateway.request("workspace.get", buildJsonObject { put("workspace_id", workspaceId) }).jsonObject
        } finally { workspaceBusy.value = false }
    } }

    fun event(topic: String, value: JsonElement) {
        when (topic) {
            "resource.updated" -> task { accept(value.jsonObject) }
            "conversation.updated" -> {
                val payload = value as? JsonObject ?: return
                if (payload.str("conversation_id") == selected || selected == null) {
                    task {
                        refreshConversationList()
                        selected?.let { id ->
                            if (payload.str("conversation_id") == id) loadConversation(id)
                            else if (payload["messages"] == null) loadConversation(id)
                        }
                    }
                }
            }
            "conversation.message.delta" -> {
                val p = value as? JsonObject ?: return
                if (p.str("conversation_id") != selected) return
                val messageId = p.str("message_id")
                val revision = p["revision"]?.jsonPrimitive?.longOrNull ?: 0
                val content = p["content"]?.jsonPrimitive?.contentOrNull
                    ?: p["delta"]?.jsonPrimitive?.contentOrNull?.let { delta ->
                        val old = conversation.value?.get("messages")?.jsonArray
                            ?.mapNotNull { it as? JsonObject }
                            ?.firstOrNull { it.str("id") == messageId }?.str("content").orEmpty()
                        old + delta
                    }
                if (content != null) {
                    conversation.value?.let { current ->
                        conversation.value = JsonObject(current + ("messages" to JsonArray(
                            current["messages"]?.jsonArray?.map { message ->
                                val m = message as? JsonObject ?: return@map message
                                if (m.str("id") == messageId && (m.long("revision") ?: 0) < revision) {
                                    JsonObject(m + mapOf("content" to JsonPrimitive(content), "revision" to JsonPrimitive(revision)))
                                } else m
                            } ?: emptyList(),
                        )))
                    }
                }
                liveReply.value?.let { reply ->
                    if (reply.conversationId == selected && reply.messageId == messageId && content != null) {
                        liveReply.value = reply.copy(content = content, status = "streaming")
                    }
                }
            }
            "conversation.status" -> {
                val p = value as? JsonObject ?: return
                if (p.str("conversation_id") != selected) return
                val messageId = p.str("message_id")
                val status = p.str("status")
                liveReply.value?.let { reply ->
                    if (reply.messageId == messageId) liveReply.value = reply.copy(status = status)
                }
                conversation.value?.let { current ->
                    conversation.value = JsonObject(current + ("messages" to JsonArray(
                        current["messages"]?.jsonArray?.map { message ->
                            val m = message as? JsonObject ?: return@map message
                            if (m.str("id") == messageId) JsonObject(m + ("status" to JsonPrimitive(status))) else m
                        } ?: emptyList(),
                    )))
                }
            }
            "conversation.execution.updated", "conversation.result.updated",
            "conversation.question.created", "conversation.question.answered", "conversation.question.cancelled",
            "conversation.activity.started", "conversation.activity.waiting_approval",
            "conversation.activity.completed", "conversation.activity.failed", "conversation.activity.cancelled",
            "approval.created", "approval.resolved" -> task {
                selected?.let { loadConversation(it) }
                loadControlPlane()
            }
            "notification.created" -> task { loadControlPlane() }
            "app.catalog.updated", "app.discovered" -> task { loadApplications() }
            "schedule.created" -> task { loadControlPlane() }
            "workspace.created", "workspace.updated", "workspace.artifact.updated", "workspace.opened" -> task { openWorkspace() }
            "task.created", "task.started", "task.waiting", "task.completed", "task.failed", "task.cancelled",
            "agent.run.created", "agent.run.started", "agent.run.updated", "agent.run.completed",
            "agent.run.failed", "agent.run.cancelled" -> task { refresh() }
            "conversation.tool.started", "conversation.tool.completed", "conversation.tool.failed" -> {
                val p = value as? JsonObject ?: return
                val conversationId = p.str("conversation_id").ifBlank { return }
                val callId = p.str("tool_call_id").ifBlank { return }
                val status = if (topic.endsWith("started")) "running" else if (topic.endsWith("failed")) "failed" else "completed"
                toolStates.value = toolStates.value + (conversationId to
                    ((toolStates.value[conversationId] ?: emptyMap()) + (callId to (p.str("capability").ifBlank { "tool" } + "|" + status))))
            }
        }
    }
}
