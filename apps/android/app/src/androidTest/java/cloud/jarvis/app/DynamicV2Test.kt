package cloud.jarvis.app

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import cloud.jarvis.app.designsystem.JarvisTheme
import cloud.jarvis.app.dynamicui.SemanticView
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Rule
import org.junit.Test

class DynamicV2Test {
    @get:Rule val compose = createComposeRule()
    @Test fun longTimelineKeepsLatestEventReachable() {
        val rows=(0 until 250).joinToString(",") { """{"id":$it,"payload":{"title":"事件 $it","password":"hidden-credential"}}""" }
        val view=Json.parseToJsonElement("""{"ui_protocol":"2.0","id":"long","title":"长任务","sections":[{"id":"events","role":"primary","component":"timeline","component_version":2,"title":"执行过程","data":[$rows],"fallback":"不可用"}]}""").jsonObject
        compose.setContent { JarvisTheme { Column { SemanticView(view) {} } } }
        compose.onNodeWithText("显示最近 200 条事件").assertIsDisplayed()
        compose.onNodeWithText("● 事件 0").assertDoesNotExist()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("● 事件 249"))
        compose.onNodeWithText("● 事件 249").assertIsDisplayed()
        compose.onNodeWithText("hidden-credential").assertDoesNotExist()
    }
    @Test fun malformedTimelineAndChartDoNotCrashSiblingPanels() {
        val view = androidx.compose.runtime.mutableStateOf(Json.parseToJsonElement("""{"ui_protocol":"2.0","id":"bad-data","title":"容错工作区","sections":[{"id":"bad","role":"primary","component":"timeline","component_version":2,"title":"执行过程","data":[null],"fallback":"不可用"},{"id":"chart","role":"primary","component":"line_chart","component_version":2,"title":"历史","data":[{"data":{"cpu":7,"gpu":{"utilization_percent":{}}}}],"fallback":"不可用"},{"id":"good","role":"summary","component":"markdown","component_version":2,"title":"结果","data":"其他面板正常","fallback":"不可用"}]}""").jsonObject)
        compose.setContent { JarvisTheme { Column { SemanticView(view.value) {} } } }
        compose.onNodeWithText("其他面板正常").assertIsDisplayed()
        compose.onNodeWithText("不可用").assertIsDisplayed()
        compose.onNodeWithText("暂无数据 · 未采集时段保留缺口").assertIsDisplayed()
        compose.runOnIdle { view.value = Json.parseToJsonElement(view.value.toString().replace("[null]", "[{\"id\":1,\"payload\":{\"title\":\"恢复成功\"}}]")).jsonObject }
        compose.onNodeWithText("● 恢复成功").assertIsDisplayed()
        compose.onNodeWithText("不可用").assertDoesNotExist()
    }
    @Test fun dangerousActionRequiresExplicitConfirmation() {
        var invoked = 0
        val view=Json.parseToJsonElement("""{"ui_protocol":"2.0","id":"risk","title":"风险确认","sections":[{"id":"cancel","role":"primary","component":"action","component_version":2,"title":"结束任务","fallback":"操作不可用","actions":[{"id":"cancel","label":"结束任务","capability":"run.cancel","resource_id":"run-a","risk":"dangerous"}]}]}""").jsonObject
        compose.setContent { JarvisTheme { Column { SemanticView(view) { invoked++ } } } }
        compose.onNode(hasText("结束任务") and hasClickAction()).performClick()
        compose.onNodeWithText("确认高风险操作").assertIsDisplayed()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, invoked) }
        compose.onNodeWithText("返回检查").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, invoked) }
        compose.onNode(hasText("结束任务") and hasClickAction()).performClick()
        compose.onNodeWithText("确认执行").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(1, invoked) }
    }
    @Test fun groupedActionsPreserveEachTargetAndFalseApproval() {
        val sent = mutableListOf<kotlinx.serialization.json.JsonObject>()
        val view=Json.parseToJsonElement("""{"ui_protocol":"2.0","id":"actions","title":"操作工作区","sections":[{"id":"actions","role":"actions","component":"action","component_version":2,"title":"可用操作","fallback":"操作不可用","actions":[{"id":"open","label":"打开关联任务","capability":"run.open","resource_id":"run-a","input":{},"risk":"read"},{"id":"reject","label":"拒绝此申请","capability":"approval.response","resource_id":"approval-b","input":{"approved":false},"risk":"write"}]}]}""").jsonObject
        compose.setContent { JarvisTheme { Column { SemanticView(view) { sent.add(it) } } } }
        compose.onNodeWithText("查看操作与详情").performClick()
        compose.onNode(hasText("打开关联任务") and hasClickAction()).performClick()
        compose.onNode(hasText("拒绝此申请") and hasClickAction()).performClick()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(Json.parseToJsonElement("""{"type":"run.open","target":"run-a"}"""), sent[0])
            org.junit.Assert.assertEquals(Json.parseToJsonElement("""{"type":"approval.response","target":"approval-b","approved":false}"""), sent[1])
        }
    }
    @Test fun taskCardDoesNotTreatUnknownStateAsSuccessOrDisplayInternalFields() {
        val view=Json.parseToJsonElement("""{"ui_protocol":"2.0","id":"task","title":"工作区","sections":[{"id":"task","role":"summary","component":"task","component_version":2,"title":"任务状态","data":{"goal":"检查服务器","status":"future_state","agent_id":"ops-agent","started_at":"invalid-time","input_json":{"password":"must-not-render"}},"fallback":"任务不可用"}]}""").jsonObject
        compose.setContent { JarvisTheme { Column { SemanticView(view) {} } } }
        compose.onNodeWithText("检查服务器").assertIsDisplayed()
        compose.onNodeWithText("未知状态：future_state").assertIsDisplayed()
        compose.onNodeWithText("已完成").assertDoesNotExist()
        compose.onNodeWithText("must-not-render").assertDoesNotExist()
        compose.onNodeWithText("开始时间 · 时间不可用").assertIsDisplayed()
    }
    @Test fun listRowsShowMetadataAndMalformedDataFallsBack() {
        val view=Json.parseToJsonElement("""{"ui_protocol":"2.0","id":"lists","title":"产物","sections":[{"id":"files","role":"resources","component":"list","component_version":2,"title":"测试与产物","data":{"items":[{"title":"result.json","description":"执行结果","status":"application/json","url":"javascript:alert(1)"}]},"fallback":"无法读取"},{"id":"bad","role":"primary","component":"list","component_version":2,"title":"异常列表","data":{"items":[{"title":7}]},"fallback":"列表格式不兼容"}]}""").jsonObject
        compose.setContent { JarvisTheme { Column { SemanticView(view) {} } } }
        compose.onNodeWithText("result.json").assertIsDisplayed()
        compose.onNodeWithText("执行结果").assertIsDisplayed()
        compose.onNodeWithText("application/json").assertIsDisplayed()
        compose.onNodeWithText("javascript:alert(1)").assertDoesNotExist()
        compose.onNodeWithText("列表格式不兼容").assertIsDisplayed()
    }
    @Test fun logsFilterWithoutInterpretingMarkup() {
        val view=Json.parseToJsonElement("""{"ui_protocol":"2.0","id":"logs","title":"诊断","sections":[{"id":"log","role":"primary","component":"log","component_version":2,"title":"服务日志","data":{"text":"ready\nERROR <script>"},"fallback":"日志不可用"}]}""").jsonObject
        compose.setContent { JarvisTheme { Column { SemanticView(view) {} } } }
        compose.onNodeWithText("1  ready").assertIsDisplayed()
        compose.onNodeWithText("筛选日志").performTextInput("error")
        compose.onNodeWithText("1  ready").assertDoesNotExist()
        compose.onNodeWithText("2  ERROR <script>").assertIsDisplayed()
        compose.onNodeWithText("筛选日志").performTextReplacement("missing")
        compose.onNodeWithText("没有匹配的日志").assertIsDisplayed()
    }
    @Test fun newerResourceReplacesEmbeddedSnapshot() {
        val view=Json.parseToJsonElement("""{"ui_protocol":"2.0","id":"live","title":"实时指标","sections":[{"id":"cpu","role":"summary","component":"metric","component_version":2,"title":"CPU","data":12,"source":"system/status","source_path":"cpu.usage_percent","source_revision":1}]}""").jsonObject
        val resource=Json.parseToJsonElement("""{"revision":2,"data":{"cpu":{"usage_percent":78}}}""").jsonObject
        compose.setContent { JarvisTheme { SemanticView(view,mapOf("system/status" to resource)) {} } }
        compose.onNodeWithText("78").assertIsDisplayed()
        compose.onNodeWithText("12").assertDoesNotExist()
    }
    @Test fun mobileActionsOpenInSheetAndUnknownComponentsFallback() {
        val view = Json.parseToJsonElement("""{
          "ui_protocol":"2.0","id":"incident","title":"服务器分析",
          "sections":[
            {"id":"summary","role":"summary","component":"metric","component_version":2,"title":"CPU","data":32,"fallback":"暂无指标"},
            {"id":"unknown","role":"primary","component":"future_widget","component_version":3,"title":"分析详情","fallback":"请更新客户端查看详情"},
            {"id":"action","role":"actions","component":"markdown","component_version":2,"title":"操作建议","data":"请先查看任务影响范围","fallback":"暂无建议"}
          ]
        }""").jsonObject
        compose.setContent { JarvisTheme { Column { SemanticView(view) {} } } }
        compose.onNodeWithText("服务器分析").assertIsDisplayed()
        compose.onNodeWithText("CPU").assertIsDisplayed()
        compose.onNodeWithText("请更新客户端查看详情").assertIsDisplayed()
        compose.onNodeWithText("操作建议").assertDoesNotExist()
        compose.onNodeWithText("查看操作与详情").performClick()
        compose.onNodeWithText("操作建议").assertIsDisplayed()
    }
    @Test fun unsupportedProtocolShowsFallback() {
        val view = Json.parseToJsonElement("""{"ui_protocol":"3.0","fallback":"请升级以查看此视图"}""").jsonObject
        compose.setContent { JarvisTheme { SemanticView(view) {} } }
        compose.onNodeWithText("请升级以查看此视图").assertIsDisplayed()
    }
}
