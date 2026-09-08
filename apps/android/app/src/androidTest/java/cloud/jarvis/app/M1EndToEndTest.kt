package cloud.jarvis.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Rule
import org.junit.Test
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Uses the real HTTP/WS server and PostgreSQL. Pass one-use pairing code and test agent token. */
class M1EndToEndTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val args = InstrumentationRegistry.getArguments()
    private val server = args.getString("server") ?: "http://10.0.2.2:18080"
    private val agentId = "android-e2e-" + UUID.randomUUID().toString()
    private val client = OkHttpClient()
    private var socket: WebSocket? = null
    private fun visible(text: String) = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
    private fun waitFor(text: String) { compose.waitUntil(20_000) { visible(text) } }

    @Test fun pairMonitorAgentAndUsage() {
        val code = requireNotNull(args.getString("pairingCode")) { "pairingCode is required" }
        val token = requireNotNull(args.getString("agentToken")) { "agentToken is required" }
        compose.onNode(hasSetTextAction() and hasText("http://100.x.x.x:8080")).performTextInput(server)
        compose.onNode(hasSetTextAction() and hasText("配对码")).performTextInput(code)
        compose.onNodeWithText("配对并连接").performClick()
        waitFor("ONLINE")
        compose.onNode(hasText("Server") and hasClickAction()).performClick()
        waitFor("Network")
        compose.onNode(hasText("Agents") and hasClickAction()).performClick()
        val registered = CountDownLatch(1)
        socket = client.newWebSocket(Request.Builder().url(server.replaceFirst("http", "ws") + "/ws").header("Authorization", "Bearer $token").build(), object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) { ws.send(buildJsonObject { put("id", UUID.randomUUID().toString()); put("type", "request"); put("topic", "agent.register"); put("payload", buildJsonObject { put("agent_id", agentId); put("name", "Android E2E Agent"); put("runtime", "instrumentation") }) }.toString()) }
            override fun onMessage(ws: WebSocket, text: String) { val m = Json.parseToJsonElement(text).jsonObject; if (m["type"]?.jsonPrimitive?.content == "response") registered.countDown() }
        })
        try {
            check(registered.await(10, TimeUnit.SECONDS)) { "agent registration timeout" }
            waitFor("Android E2E Agent")
            socket!!.send(buildJsonObject { put("id", UUID.randomUUID().toString()); put("type", "request"); put("topic", "agent.task.started"); put("payload", buildJsonObject { put("agent_id", agentId); put("status", "running"); put("task_id", "Android live task"); put("provider", "fixture"); put("model", "fixture-model") }) }.toString())
            waitFor("Android live task")
            val now = Instant.now().toString()
            val record = buildJsonObject { put("id", UUID.randomUUID().toString()); put("agent_id", agentId); put("provider", "fixture"); put("model", "fixture-model"); put("input_tokens", 123); put("output_tokens", 45); put("cached_input_tokens", 23); put("reasoning_tokens", 5); put("latency_ms", 10); put("status", "success"); put("started_at", now); put("finished_at", now) }
            client.newCall(Request.Builder().url("$server/api/v1/llm/requests").header("Authorization", "Bearer $token").post(record.toString().toRequestBody("application/json".toMediaType())).build()).execute().use { check(it.isSuccessful) { "usage logging failed: ${it.code}" } }
            compose.onNode(hasText("AI") and hasClickAction()).performClick()
            waitFor("fixture")
            compose.onNode(hasText("Agents") and hasClickAction()).performClick()
            compose.onNodeWithTag("agent-detail-$agentId").performScrollTo().performClick()
            waitFor("Identity & Session")
            compose.onNodeWithText("Today · UTC").performScrollTo().assertIsDisplayed()
        } finally { socket?.close(1000, "test complete"); client.dispatcher.executorService.shutdown() }
    }
}
