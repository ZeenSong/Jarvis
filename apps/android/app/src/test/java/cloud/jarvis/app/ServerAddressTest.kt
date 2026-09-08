package cloud.jarvis.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ServerAddressTest {
    @Test fun tailnetIpAndMagicDnsAreSupported() {
        assertEquals("http://100.80.1.2:8080", GatewayClient.normalizeServer("100.80.1.2:8080"))
        assertEquals("https://jarvis.tailnet.ts.net", GatewayClient.normalizeServer("https://jarvis.tailnet.ts.net/"))
        assertEquals("http://[fd7a:115c:a1e0::1]:8080", GatewayClient.normalizeServer("http://[fd7a:115c:a1e0::1]:8080"))
    }
    @Test fun credentialsAndPathsAreRejected() {
        listOf("http://user:secret@server", "http://server/path", "ftp://server", "http://server?token=secret").forEach {
            assertThrows(IllegalArgumentException::class.java) { GatewayClient.normalizeServer(it) }
        }
    }
}
