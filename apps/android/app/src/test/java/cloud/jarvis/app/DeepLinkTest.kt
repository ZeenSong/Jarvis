package cloud.jarvis.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The notification -> deep link -> screen chain is the only path from a push to
 * the result the user was told about, so it is pinned here instead of relying on
 * a manual walkthrough on a device.
 */
class DeepLinkTest {
    @Test fun notificationTargetsPointAtTheRightScreen() {
        assertEquals("jarvis://task/run-1", notificationTarget("task_completed", "n1", "run-1"))
        assertEquals("jarvis://task/run-1", notificationTarget("task_failed", "n2", "run-1"))
        assertEquals("jarvis://task/run-1", notificationTarget("task_question", "n3", "run-1"))
        assertEquals("jarvis://conversation/conv-1", notificationTarget("question", "n4", "conv-1"))
        // An approval references the approval id, which has no run to open.
        assertEquals("jarvis://notification/approval-1", notificationTarget("approval", "approval-1", "approval-1"))
        assertEquals("jarvis://notification/n5", notificationTarget("something_new", "n5", ""))
    }

    @Test fun everyNotificationTargetResolvesToANavigationRoute() {
        val cases = mapOf(
            "task_completed" to "run/run-1",
            "task_failed" to "run/run-1",
            "task_question" to "run/run-1",
            "question" to "conversation/conv-1",
            "approval" to "notification/approval-1",
        )
        for ((kind, expected) in cases) {
            val reference = if (kind == "question") "conv-1" else if (kind == "approval") "approval-1" else "run-1"
            val id = if (kind == "approval") "approval-1" else "n"
            assertEquals(kind, expected, deepLinkTarget(notificationTarget(kind, id, reference)))
        }
    }

    @Test fun explicitDeepLinksMapToRoutes() {
        assertEquals("home", deepLinkTarget("jarvis://home"))
        assertEquals("conversation/conv-1", deepLinkTarget("jarvis://conversation/conv-1"))
        assertEquals("run/run-1", deepLinkTarget("jarvis://task/run-1"))
        assertEquals("workspace/ws-1", deepLinkTarget("jarvis://workspace/ws-1"))
        assertEquals("space/space-1", deepLinkTarget("jarvis://space/space-1"))
        assertEquals("app/immich", deepLinkTarget("jarvis://app/immich"))
        assertEquals("notification/n-1", deepLinkTarget("jarvis://notification/n-1"))
    }

    @Test fun malformedAndForeignLinksAreIgnored() {
        assertNull(deepLinkTarget(null))
        assertNull(deepLinkTarget(""))
        assertNull(deepLinkTarget("https://task/run-1"))
        assertNull(deepLinkTarget("jarvis://unknown/run-1"))
        assertNull(deepLinkTarget("jarvis://task"))
        assertNull(deepLinkTarget("jarvis://task/"))
        assertNull(deepLinkTarget("jarvis://://"))
        assertNull(deepLinkTarget("not a uri at all"))
    }

    @Test fun trailingSegmentsAndQueriesDoNotChangeTheTarget() {
        assertEquals("run/run-1", deepLinkTarget("jarvis://task/run-1/"))
        assertEquals("run/run-1", deepLinkTarget("jarvis://task/run-1?source=push"))
        assertEquals("conversation/conv-1", deepLinkTarget("JARVIS://conversation/conv-1"))
    }
}
