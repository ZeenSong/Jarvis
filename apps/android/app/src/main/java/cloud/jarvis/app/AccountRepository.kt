package cloud.jarvis.app

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

data class ProviderOption(val id: String, val name: String, val credentialProvider: String)

/**
 * Account, household services and user administration. These endpoints are
 * shared with the Web client and still use HTTP; the bearer session makes them
 * available to Android without a cookie jar.
 */
class AccountRepository(
    private val gateway: GatewayClient,
    private val scope: CoroutineScope,
    private val error: MutableStateFlow<String?>,
) {
    val me = MutableStateFlow<JsonObject?>(null)
    val sessions = MutableStateFlow<List<JsonObject>>(emptyList())
    val users = MutableStateFlow<List<JsonObject>>(emptyList())
    val capabilities = MutableStateFlow<Map<String, List<String>>>(emptyMap())
    val credentials = MutableStateFlow<List<JsonObject>>(emptyList())
    val credentialStatus = MutableStateFlow<Map<String, String>>(emptyMap())
    val providers = MutableStateFlow(
        listOf(
            ProviderOption("home-assistant", "Home Assistant", "home-assistant"),
            ProviderOption("immich", "Immich", "immich"),
        ),
    )
    val inviteToken = MutableStateFlow<String?>(null)
    val loading = MutableStateFlow(false)
    val notice = MutableStateFlow<String?>(null)

    val credentialProvider = MutableStateFlow("home-assistant")

    fun selectProvider(value: String) { credentialProvider.value = value }

    fun clear() {
        me.value = null; sessions.value = emptyList(); users.value = emptyList()
        capabilities.value = emptyMap(); credentials.value = emptyList()
        credentialStatus.value = emptyMap(); inviteToken.value = null
        notice.value = null; loading.value = false
    }

    private fun task(block: suspend () -> Unit) {
        scope.launch { runCatching { block() }.onFailure { error.value = friendlyError(it) } }
    }

    fun refresh() { task { refreshNow() } }

    suspend fun refreshNow() {
        loading.value = true
        try {
            val current = gateway.http("GET", "/api/v2/auth/me").jsonObject
            me.value = current
            sessions.value = current.objects("sessions")
            if (current["user"]?.jsonObject?.str("role") == "admin") {
                runCatching { users.value = gateway.http("GET", "/api/v2/auth/users").jsonArray.map { it.jsonObject } }
                val policies = users.value.map { user ->
                    val id = user.str("id")
                    val list = runCatching {
                        gateway.http("GET", "/api/v2/auth/users/$id/capabilities").jsonObject
                            .array("capabilities").mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                    }.getOrDefault(emptyList())
                    id to list
                }
                capabilities.value = policies.toMap()
            } else {
                users.value = emptyList()
                capabilities.value = emptyMap()
            }
            runCatching { loadCredentials() }
        } finally {
            loading.value = false
        }
    }

    fun refreshCredentials() { task { loadCredentials() } }

    suspend fun loadCredentials() {
        credentials.value = gateway.request("integration.credential.list").jsonArray.map { it.jsonObject }
        val discovered = runCatching { gateway.request("integration.list").jsonObject }.getOrNull()
        val items = discovered?.array("integrations")?.mapNotNull { it as? JsonObject }.orEmpty()
            .filter { it.str("id").isNotBlank() && it.str("name").isNotBlank() }
            .map {
                ProviderOption(
                    it.str("id"),
                    it.str("name"),
                    it.str("credential_provider").ifBlank { it.str("id") },
                )
            }
        if (items.isNotEmpty()) {
            val merged = LinkedHashMap<String, ProviderOption>()
            providers.value.forEach { merged[it.credentialProvider] = it }
            items.forEach { merged[it.credentialProvider] = it }
            val values = merged.values.sortedBy { it.name.lowercase() }
            providers.value = values
            if (values.none { it.credentialProvider == credentialProvider.value }) credentialProvider.value = values.firstOrNull()?.credentialProvider ?: "home-assistant"
        }
    }

    fun createInvite(username: String) { task {
        if (username.trim().length < 3) throw IllegalStateException("成员用户名至少 3 个字符")
        val value = gateway.http("POST", "/api/v2/auth/invites", buildJsonObject { put("username", username.trim()) }).jsonObject
        inviteToken.value = value.str("token")
        users.value = gateway.http("GET", "/api/v2/auth/users").jsonArray.map { it.jsonObject }
    } }

    fun changeRole(userId: String, role: String) { task {
        gateway.http("PATCH", "/api/v2/auth/users/$userId", buildJsonObject { put("role", role) })
        refreshNow()
    } }

    fun changeCapability(userId: String, capability: String, allowed: Boolean) { task {
        gateway.http(
            "PATCH", "/api/v2/auth/users/$userId/capabilities",
            buildJsonObject { put("capability", capability); put("allowed", allowed) },
        )
        val current = capabilities.value[userId].orEmpty()
        capabilities.value = capabilities.value + (userId to (current.filter { it != capability } + if (allowed) listOf(capability) else emptyList()))
    } }

    fun revokeSession(sessionId: String) { task {
        gateway.http("DELETE", "/api/v2/auth/sessions/$sessionId")
        sessions.value = sessions.value.filterNot { it.str("id") == sessionId }
    } }

    fun revokeCredential(id: String) { task {
        gateway.request("integration.credential.revoke", buildJsonObject { put("credential_id", id) })
        credentialStatus.value = credentialStatus.value - id
        loadCredentials()
        notice.value = "连接已撤销"
    } }

    fun saveCredential(provider: String, label: String, secret: String) { task {
        if (secret.isBlank()) return@task
        notice.value = "已保存，正在验证连接…"
        val saved = gateway.request(
            "integration.credential.put",
            buildJsonObject {
                put("provider", provider)
                put("label", label.ifBlank { "Jarvis 服务连接" })
                put("secret", secret)
                put("metadata", buildJsonObject { put("source", "Jarvis Android 设置") })
            },
        ).jsonObject
        val id = saved.str("id")
        credentialStatus.value = credentialStatus.value + (id to "testing")
        val connected = testCredential(id)
        credentialStatus.value = credentialStatus.value + (id to if (connected) "connected" else "failed")
        notice.value = if (connected) "连接已验证，可以在 Jarvis 中使用。" else "已加密保存，但连接验证失败；请检查凭据和服务权限。"
        loadCredentials()
    } }

    fun verifyCredential(id: String) { task {
        credentialStatus.value = credentialStatus.value + (id to "testing")
        val connected = testCredential(id)
        credentialStatus.value = credentialStatus.value + (id to if (connected) "connected" else "failed")
        notice.value = if (connected) "连接已验证。" else "暂时无法验证连接；请检查凭据与服务状态。"
    } }

    suspend fun testCredential(id: String): Boolean {
        val result = runCatching {
            gateway.http("POST", "/api/v2/integration/credentials/$id/test").jsonObject
        }.getOrNull() ?: return false
        return result["connected"]?.jsonPrimitive?.booleanOrNull == true
    }

    suspend fun casaosAccount(): JsonObject? =
        runCatching { gateway.http("GET", "/api/v2/integrations/casaos").jsonObject }.getOrNull()

    suspend fun casaosLogin(username: String, password: String): Boolean = runCatching {
        gateway.http(
            "POST", "/api/v2/integrations/casaos/login",
            buildJsonObject { put("username", username); put("password", password) },
        )
        true
    }.getOrElse { throw IllegalStateException(friendlyError(it)) }

    suspend fun configureApp(appId: String): JsonObject =
        gateway.request("app.configure", buildJsonObject { put("mode", "auto"); put("app_id", appId) }).jsonObject

    suspend fun testApp(appId: String): JsonObject =
        gateway.request("app.test", buildJsonObject { put("app_id", appId) }).jsonObject

    suspend fun putAppCredential(appId: String, appName: String, secret: String): JsonObject {
        val saved = gateway.request(
            "integration.credential.put",
            buildJsonObject {
                put("provider", appId)
                put("label", "${appName} 连接")
                put("secret", secret)
                put("metadata", buildJsonObject { put("source", "Jarvis 应用页"); put("app_id", appId) })
            },
        ).jsonObject
        return saved
    }
}
