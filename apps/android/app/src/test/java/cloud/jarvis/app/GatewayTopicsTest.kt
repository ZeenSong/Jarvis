package cloud.jarvis.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GatewayTopicsTest {
    @Test fun subscriptionFitsTheGatewayLimit() {
        val normal = gatewaySubscriptionTopics(false)
        val detailed = gatewaySubscriptionTopics(true)
        assertTrue("normal ${normal.size}", normal.size <= 32)
        assertTrue("detailed ${detailed.size}", detailed.size <= 32)
        assertEquals(normal.size + 1, detailed.size)
        assertEquals(normal.size, normal.distinct().size)
        assertEquals(detailed.size, detailed.distinct().size)
    }

    @Test fun replyAndTaskEventsAreAlwaysSubscribed() {
        val topics = gatewaySubscriptionTopics(false)
        listOf(
            "conversation.message.delta",
            "conversation.status",
            "conversation.result.updated",
            "approval.created",
            "notification.created",
            "resource.updated",
            "app.catalog.updated",
        ).forEach { topic -> assertTrue(topic, topic in topics) }
    }
}
