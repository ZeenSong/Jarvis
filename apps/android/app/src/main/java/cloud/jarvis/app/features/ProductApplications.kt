package cloud.jarvis.app.features

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cloud.jarvis.app.AccountRepository
import cloud.jarvis.app.array
import cloud.jarvis.app.bool
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.friendlyError
import cloud.jarvis.app.int
import cloud.jarvis.app.objects
import cloud.jarvis.app.str
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

private val appRunStates = mapOf("running" to "运行中", "stopped" to "已停止")

private fun appState(value: String): String = appRunStates[value] ?: "状态未知"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductApplications(
    value: JsonObject?,
    refresh: () -> Unit,
    openApp: (String) -> Unit = {},
    askApp: (String) -> Unit = {},
    catalog: JsonObject? = null,
    account: AccountRepository? = null,
    compact: Boolean = false,
    limit: Int? = null,
    onOpenFull: (() -> Unit)? = null,
    initialApp: String? = null,
) {
    val palette = jarvisColors()
    val scope = rememberCoroutineScope()
    var selected by remember { mutableStateOf<String?>(null) }
    var step by remember { mutableStateOf("idle") }
    var connectError by remember { mutableStateOf("") }
    var credential by remember { mutableStateOf("") }
    var connectResult by remember { mutableStateOf<JsonObject?>(null) }
    var saving by remember { mutableStateOf(false) }
    var connected by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
    var casaosLoginOpen by remember { mutableStateOf(false) }
    var casaosUsername by remember { mutableStateOf("") }
    var casaosPassword by remember { mutableStateOf("") }
    var casaosBusy by remember { mutableStateOf(false) }
    var casaosError by remember { mutableStateOf("") }

    val apps = value?.objects("apps").orEmpty()
    LaunchedEffect(initialApp, apps) {
        if (initialApp != null && apps.any { it.str("id") == initialApp }) selected = initialApp
    }
    val catalogApps = catalog?.objects("apps").orEmpty()
    val status = value?.str("status").orEmpty()
    fun entry(id: String) = catalogApps.firstOrNull { it.str("id") == id }
    fun isConnected(id: String): Boolean = connected[id] ?: (entry(id)?.bool("ready") == true)

    LaunchedEffect(selected) {
        step = "idle"; connectError = ""; credential = ""; connectResult = null
        val e = selected?.let(::entry)
        if (e?.bool("connected") == true && e.bool("credential_configured").not()) step = "credential"
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (status != "ready") {
            val titles = mapOf(
                "not_configured" to "尚未连接 CasaOS",
                "authentication_required" to "CasaOS 需要重新认证",
                "configuration_error" to "CasaOS 连接配置需要检查",
                "unavailable" to "暂时无法读取应用",
            )
            JarvisCard(padding = 4.dp) {
            EmptyState(
                title = titles[status] ?: "正在读取应用",
                text = when (status) {
                    "authentication_required" -> "当前 CasaOS 会话已失效；重新连接后恢复应用状态。"
                    "not_configured" -> "需要配置服务端 CasaOS 连接，才能读取已安装应用。"
                    "configuration_error" -> "服务端 CasaOS 凭据文件权限不符合要求。"
                    else -> "应用列表连接异常不会影响你直接使用原应用。"
                },
                action = if (status == "authentication_required" && account != null) "重新连接 CasaOS" else "刷新",
                onAction = {
                    if (status == "authentication_required" && account != null) {
                        scope.launch {
                            val current = account.casaosAccount()
                            casaosUsername = current?.str("username").orEmpty()
                            casaosError = ""
                            casaosLoginOpen = true
                        }
                    } else refresh()
                },
            )
            }
        } else if (apps.isEmpty()) {
            JarvisCard(padding = 4.dp) {
                EmptyState("还没有安装应用", "CasaOS 已连接，当前没有已安装应用。", action = "刷新", onAction = refresh)
            }
        } else {
            if (!compact) {
                val online = apps.count { it.str("status") == "running" }
                val configured = catalog?.get("configured_count")?.jsonPrimitive?.intOrNull
                    ?: catalogApps.count { it.bool("connected") }
                val pending = catalog?.get("unconfigured_count")?.jsonPrimitive?.intOrNull ?: 0
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Pill("${apps.size} 个应用", color = palette.text, background = palette.surface2)
                    Pill("$online 个运行中", color = palette.sage, background = palette.sage.copy(alpha = 0.1f))
                    Pill("$configured 个已连接 Jarvis", color = palette.accent, background = palette.accentSoft)
                    if (pending > 0) Pill("$pending 个待连接", color = palette.danger, background = palette.danger.copy(alpha = 0.1f))
                }
            }
            val visible = apps.let { if (limit != null) it.take(limit) else it }
            visible.chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { app ->
                        val id = app.str("id")
                        val connectedNow = isConnected(id)
                        val waiting = entry(id)?.bool("connected") == true && entry(id)?.bool("credential_configured") == false
                        Card(
                            onClick = { selected = id },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = palette.surface),
                            border = androidx.compose.foundation.BorderStroke(1.dp, palette.line),
                        ) {
                            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    AppIdentityMark(app.str("name"), id, size = 40.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Text(
                                        app.str("name"),
                                        Modifier.weight(1f),
                                        style = MaterialTheme.typography.titleSmall,
                                        color = palette.textStrong,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    StatusBadge(
                                        if (connectedNow) "已连接" else if (waiting) "待凭据" else "CasaOS",
                                        if (connectedNow) palette.accent else if (waiting) palette.danger else palette.muted2,
                                    )
                                    Spacer(Modifier.weight(1f))
                                    Text(
                                        appState(app.str("status")),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (app.str("status") == "running") palette.sage else palette.muted,
                                    )
                                }
                            }
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            if (limit != null && apps.size > limit && onOpenFull != null) {
                OutlineButton("查看全部 ${apps.size} 个应用", Modifier.fillMaxWidth(), onClick = onOpenFull)
            }
            if (!compact) {
                TextButton(onClick = refresh, contentPadding = PaddingValues(0.dp)) {
                    Text("刷新应用状态", color = palette.muted, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }

    val app = apps.firstOrNull { it.str("id") == selected }
    if (app != null && status == "ready") {
        val id = app.str("id")
        val info = entry(id)
        val ready = isConnected(id)
        val waitingForCredential = info?.bool("connected") == true && info.bool("credential_configured").not()
        var descriptionOpen by remember(id) { mutableStateOf(false) }
        val credentialLabel = ((connectResult?.get("credential") as? JsonObject)?.str("label"))
            ?.ifBlank { null } ?: info?.str("credential_label").orEmpty().ifBlank { "${app.str("name")} 凭据" }
        val credentialHint = ((connectResult?.get("credential") as? JsonObject)?.str("hint"))
            ?.ifBlank { null } ?: info?.str("credential_hint").orEmpty()
        val credentialWhere = ((connectResult?.get("credential") as? JsonObject)?.str("where_url"))
            ?.ifBlank { null } ?: info?.str("credential_where").orEmpty()
        val credentialFormat = ((connectResult?.get("credential") as? JsonObject)?.str("format"))
            ?.ifBlank { null } ?: info?.str("credential_format").orEmpty()

        ModalBottomSheet(
            onDismissRequest = { selected = null },
            containerColor = palette.surface,
            dragHandle = { BottomSheetDefaults.DragHandle(color = palette.lineBright) },
        ) {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    AppIdentityMark(app.str("name"), id, size = 48.dp)
                    Column(Modifier.weight(1f)) {
                        Eyebrow("CASAOS APPLICATION")
                        Text(app.str("name"), style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
                    }
                    StatusBadge(appState(app.str("status")), if (app.str("status") == "running") palette.sage else palette.muted)
                }
                if (app.str("description").isNotBlank()) {
                    TextButton(onClick = { descriptionOpen = !descriptionOpen }, contentPadding = PaddingValues(0.dp)) {
                        Text("应用简介 · 来自 CasaOS", style = MaterialTheme.typography.labelMedium, color = palette.accent)
                    }
                    if (descriptionOpen) {
                        JarvisCard(padding = 14.dp, color = palette.surface2) {
                            Text(app.str("description"), style = MaterialTheme.typography.bodySmall, color = palette.textDim)
                        }
                    }
                }
                JarvisCard(padding = 14.dp, color = palette.surface2) {
                    Column {
                        KeyValueRow("运行状态", appState(app.str("status")))
                        KeyValueRow("应用服务", "CasaOS")
                        Text("服务数量：${app.str("service_count").ifBlank { "未知" }}", style = MaterialTheme.typography.bodySmall, color = palette.textDim)
                        KeyValueRow("应用标识", id, monospace = true)
                        info?.str("base_url")?.takeIf { it.isNotBlank() }?.let { KeyValueRow("检测地址", it, monospace = true) }
                        info?.int("operations_count")?.let { KeyValueRow("可调用操作", "$it 个") }
                    }
                }

                when {
                    ready -> {
                        Text("已连接 Jarvis。可以直接让 Jarvis 读取或操作它；不需要每次重新询问连接方式。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                        PrimaryButton("让 Jarvis 试用此应用", Modifier.fillMaxWidth(), icon = JarvisIcons.Sparkle) {
                            askApp("请先用 app_list 确认 ${app.str("name")} 的连接状态，然后用 app_tools_list 查看它的可用操作，并告诉我可以做什么。")
                            selected = null
                        }
                    }
                    info?.str("mode") == "unsupported" -> {
                        Text(
                            info.str("credential_hint").ifBlank { info.str("description") }.ifBlank { "该应用暂不支持自动连接。可以让 Jarvis 分析后再决定。" },
                            style = MaterialTheme.typography.bodySmall,
                            color = palette.muted,
                        )
                        OutlineButton("让 Jarvis 分析", Modifier.fillMaxWidth(), icon = JarvisIcons.Sparkle) {
                            askApp("CasaOS 里安装了 ${app.str("name")}。请先调用 app_list，再调用 app_setup_guide 读取检测到的地址；如果它需要 MCP 端点或 API 文档才能配置，请明确告诉我需要提供什么，不要编造。")
                            selected = null
                        }
                    }
                    info?.str("mode") == "unknown" || info == null -> {
                        Text("Jarvis 还不会自动配置这个应用。可以让 Jarvis 读取检测到的地址，再根据它的 API/MCP 文档确定连接方式。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                        OutlineButton("让 Jarvis 分析", Modifier.fillMaxWidth(), icon = JarvisIcons.Sparkle) {
                            askApp("CasaOS 里安装了 ${app.str("name")}。请先调用 app_list，再调用 app_setup_guide 读取检测到的地址；如果它需要 MCP 端点或 API 文档才能配置，请明确告诉我需要提供什么，不要编造。")
                            selected = null
                        }
                    }
                    else -> {
                        Text(
                            "Jarvis 会自动使用 CasaOS 检测到的地址，并把凭据加密保存在服务端。凭据不会显示在页面或对话里。",
                            style = MaterialTheme.typography.bodySmall,
                            color = palette.muted,
                        )
                        if (step == "credential") {
                            JarvisCard(padding = 14.dp, color = palette.surface2) {
                                Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                                    Text(credentialLabel, style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                                    Text(
                                        credentialHint.ifBlank { "在应用自己的设置页创建只读凭据。" },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = palette.muted,
                                    )
                                    if (credentialWhere.isNotBlank()) {
                                        Text(credentialWhere, style = MaterialTheme.typography.labelSmall, color = palette.accent)
                                    }
                                    OutlinedTextField(
                                        value = credential,
                                        onValueChange = { if (it.length <= 16384) credential = it },
                                        label = { Text(if (credentialFormat == "user_password") "用户名:密码" else "只读 API Key 或访问令牌") },
                                        visualTransformation = PasswordVisualTransformation(),
                                        singleLine = true,
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(11.dp),
                                    )
                                    PrimaryButton(
                                        if (saving) "正在验证…" else "保存并验证",
                                        Modifier.fillMaxWidth(),
                                        enabled = credential.isNotBlank(),
                                        loading = saving,
                                    ) {
                                        account ?: return@PrimaryButton
                                        scope.launch {
                                            saving = true; connectError = ""
                                            runCatching {
                                                val saved = account.putAppCredential(id, app.str("name"), credential)
                                                val ok = account.testCredential(saved.str("id"))
                                                credential = ""
                                                if (ok) {
                                                    connected = connected + (id to true)
                                                    step = "connected"
                                                    refresh()
                                                } else {
                                                    step = "credential"
                                                    connectError = "凭据已加密保存，但暂时无法验证连接。请检查应用是否运行、凭据权限是否正确。"
                                                    refresh()
                                                }
                                            }.onFailure { connectError = friendlyError(it); step = "credential" }
                                            saving = false
                                        }
                                    }
                                    if (connectError.isNotBlank()) Text(connectError, color = palette.danger, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        } else {
                            PrimaryButton(
                                when (step) {
                                    "verifying" -> "正在连接…"
                                    "connected" -> "已连接"
                                    else -> if (ready) "已连接" else "一键连接 Jarvis"
                                },
                                Modifier.fillMaxWidth(),
                                enabled = step != "connected",
                                loading = step == "verifying",
                            ) {
                                account ?: return@PrimaryButton
                                scope.launch {
                                    step = "verifying"; connectError = ""
                                    runCatching {
                                        val result = account.configureApp(id)
                                        connectResult = result
                                        if (result.bool("credential_required")) {
                                            step = "credential"
                                        } else {
                                            val tested = account.testApp(id)
                                            if (tested.bool("connected")) {
                                                connected = connected + (id to true)
                                                step = "connected"
                                                refresh()
                                            } else {
                                                step = "error"
                                                connectError = "连接已写入，但验证失败。请检查应用是否运行，或让 Jarvis 查看配置步骤。"
                                            }
                                        }
                                    }.onFailure { step = "error"; connectError = friendlyError(it) }
                                }
                            }
                            if (step == "connected") Text("连接成功，可以回到对话让 Jarvis 调用它。", color = palette.sage, style = MaterialTheme.typography.bodySmall)
                            if (step == "error" || connectError.isNotBlank()) Text(connectError, color = palette.danger, style = MaterialTheme.typography.bodySmall)
                        }
                        if (step != "credential") {
                            TextButton(
                                onClick = {
                                    askApp(
                                        if (ready) "请先用 app_list 确认 ${app.str("name")} 的连接状态，然后用 app_tools_list 查看它的可用操作，并告诉我可以做什么。"
                                        else "CasaOS 里安装了 ${app.str("name")}。请先调用 app_list 读取真实状态，再调用 app_setup_guide 告诉我怎么连接它的 API/MCP；不要编造地址或凭据。",
                                    )
                                    selected = null
                                },
                                contentPadding = PaddingValues(0.dp),
                            ) {
                                Text(if (ready) "让 Jarvis 试用此应用" else "让 Jarvis 告诉我怎么配置", color = palette.accent)
                            }
                        }
                    }
                }
                if (waitingForCredential && step != "credential") {
                    Text("当前连接的凭据尚未填写。", style = MaterialTheme.typography.bodySmall, color = palette.danger)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlineButton("在应用中打开", Modifier.weight(1f), icon = JarvisIcons.Globe) { openApp(id); selected = null }
                    OutlineButton("关闭应用详情", Modifier.weight(1f)) { selected = null }
                }
            }
        }
    }

    if (casaosLoginOpen) {
        AlertDialog(
            onDismissRequest = { if (!casaosBusy) casaosLoginOpen = false },
            title = { Text("连接 CasaOS") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("输入 CasaOS 账号完成连接。密码只用于本次登录，不会保存到手机或对话里。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                    OutlinedTextField(casaosUsername, { casaosUsername = it }, label = { Text("CasaOS 用户名") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(casaosPassword, { casaosPassword = it }, label = { Text("CasaOS 密码") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                    if (casaosError.isNotBlank()) Text(casaosError, color = palette.danger, style = MaterialTheme.typography.bodySmall)
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !casaosBusy && casaosUsername.isNotBlank() && casaosPassword.isNotBlank(),
                    onClick = {
                        account ?: return@TextButton
                        scope.launch {
                            casaosBusy = true; casaosError = ""
                            runCatching {
                                account.casaosLogin(casaosUsername, casaosPassword)
                                casaosLoginOpen = false
                                casaosPassword = ""
                                refresh()
                            }.onFailure { casaosError = friendlyError(it) }
                            casaosBusy = false
                        }
                    },
                ) { Text(if (casaosBusy) "连接中…" else "登录并连接") }
            },
            dismissButton = { TextButton(onClick = { if (!casaosBusy) casaosLoginOpen = false }) { Text("取消") } },
        )
    }
}


/**
 * Keeps the original two-argument entry point (used by the Compose ui tests and
 * internal callers) while the richer overload stays available for the app.
 */
@Composable
fun ProductApplications(value: JsonObject?, refresh: () -> Unit) {
    ProductApplications(value = value, refresh = refresh, openApp = {}, askApp = {})
}
