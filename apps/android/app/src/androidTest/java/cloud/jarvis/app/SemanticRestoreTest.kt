package cloud.jarvis.app

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class SemanticRestoreTest {
    private val cache=object:SnapshotDao {
        override suspend fun all()=emptyList<Snapshot>()
        override suspend fun put(snapshot:Snapshot) {}
        override suspend fun clear() {}
    }
    @Test fun compatibleSemanticSnapshotRestoresAndNullClearsIt()=runBlocking {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
        try {
            val repo=M2Repository(GatewayClient(scope,{_,_->},{ }),scope,cache,MutableStateFlow(null))
            repo.restore(Snapshot("m3-semantic-view","""{"ui_protocol":"2.0","id":"saved","title":"已保存视图","sections":[]}""",1))
            assertEquals("saved",repo.semanticView.value?.get("id")?.jsonPrimitive?.content)
            repo.restore(Snapshot("m3-semantic-view","null",2))
            assertNull(repo.semanticView.value)
        } finally {scope.cancel()}
    }
    @Test fun incompatibleSemanticSnapshotDoesNotMaskLegacyView()=runBlocking {
        val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
        try {
            val repo=M2Repository(GatewayClient(scope,{_,_->},{ }),scope,cache,MutableStateFlow(null))
            repo.restore(Snapshot("m2-view","""{"version":1,"title":"兼容视图","blocks":[]}""",1))
            repo.restore(Snapshot("m3-semantic-view","""{"ui_protocol":"3.0","id":"future"}""",2))
            assertNull(repo.semanticView.value)
            assertEquals("兼容视图",repo.view.value?.get("title")?.jsonPrimitive?.content)
            repo.restore(Snapshot("m3-semantic-view","""{"ui_protocol":{},"sections":[]}""",3))
            assertNull(repo.semanticView.value)
        } finally {scope.cancel()}
    }
}
