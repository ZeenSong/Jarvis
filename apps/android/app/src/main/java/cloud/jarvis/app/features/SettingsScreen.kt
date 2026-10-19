package cloud.jarvis.app.features

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import cloud.jarvis.app.AccountRepository
import cloud.jarvis.app.JarvisRepository
import cloud.jarvis.app.capabilityLabel
import cloud.jarvis.app.capabilityLabels
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.fullDateTime
import cloud.jarvis.app.relativeTime
import cloud.jarvis.app.str
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

@Composable
fun SettingsScreen(
    repo: JarvisRepository,
    light: Boolean,
    style: JarvisStyle,
    onToggleLight: (Boolean) -> Unit,
    onStyleChange: (JarvisStyle) -> Unit,
    developer: Boolean,
    onDeveloperChange: (Boolean) -> Unit,
    onOpenHermes: () -> Unit,
    onOpenSystem: () -> Unit,
    onLogout: () -> Unit,
) {
    val palette = jarvisColors()
    val account = repo.account
    val me by account.me.collectAsStateWithLifecycle()
    val sessions by account.sessions.collectAsStateWithLifecycle()
    val users by account.users.collectAsStateWithLifecycle()
    val capabilities by account.capabilities.collectAsStateWithLifecycle()
    val credentials by account.credentials.collectAsStateWithLifecycle()
    val credentialStatus by account.credentialStatus.collectAsStateWithLifecycle()
    val providers by account.providers.collectAsStateWithLifecycle()
    val provider by account.credentialProvider.collectAsStateWithLifecycle()
    val inviteToken by account.inviteToken.collectAsStateWithLifecycle()
    val notice by account.notice.collectAsStateWithLifecycle()
    val loading by account.loading.collectAsStateWithLifecycle()
    val connection by repo.gateway.state.collectAsStateWithLifecycle()
    val latency by repo.gateway.latency.collectAsStateWithLifecycle()
    val savedAt by repo.savedAt.collectAsStateWithLifecycle()
    val background by repo.backgroundEnabled.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    var providerMenu by remember { mutableStateOf(false) }
    var label by remember { mutableStateOf("") }
    var secret by remember { mutableStateOf("") }
    var inviteName by remember { mutableStateOf("") }
    var roleMenuFor by remember { mutableStateOf<String?>(null) }
    val user = me?.get("user") as? JsonObject
    val isAdmin = user?.str("role") == "admin"

    LaunchedEffect(Unit) { runCatching { account.refreshNow() } }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(top = 10.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        // Account hero.
        Box(
            Modifier.fillMaxWidth()
                .background(
                    Brush.linearGradient(listOf(palette.surface, palette.hero2)),
                    RoundedCornerShape(22.dp),
                )
                .border(1.dp, palette.line, RoundedCornerShape(22.dp))
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(54.dp).background(palette.accentSoft, RoundedCornerShape(17.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        user?.str("username")?.take(1)?.uppercase() ?: "J",
                        style = MaterialTheme.typography.headlineSmall,
                        color = palette.accent,
                    )
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Eyebrow("ACCOUNT / SETTINGS")
                    Text(user?.str("username") ?: "Jarvis", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
                    Text(
                        if (isAdmin) "管理员 · 私人云设置" else "成员 · 私人云设置",
                        style = MaterialTheme.typography.bodySmall,
                        color = palette.muted,
                    )
                }
                StatusBadge(
                    when (connection) {
                        cloud.jarvis.app.ConnectionState.online -> "已连接"
                        cloud.jarvis.app.ConnectionState.connecting -> "连接中"
                        cloud.jarvis.app.ConnectionState.reconnecting -> "重连中"
                        cloud.jarvis.app.ConnectionState.unauthorized -> "请重新登录"
                        else -> "离线"
                    },
                    if (connection == cloud.jarvis.app.ConnectionState.online) palette.sage else palette.danger,
                )
            }
        }

        AppearanceSection(light, style, onToggleLight, onStyleChange)

        JarvisCard(padding = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading("连接", eyebrow = "PRIVATE CLOUD", subtitle = repo.gateway.serverUrl() ?: "尚未登录")
                KeyValueRow("网关延迟", latency?.let { "$it ms" } ?: "—")
                KeyValueRow("最近缓存", savedAt?.let { fullDateTime(java.time.Instant.ofEpochMilli(it).toString()) } ?: "—")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("保持后台连接", style = MaterialTheme.typography.titleSmall, color = palette.text)
                        Text("常驻通知维持实时事件，系统强制停止后仍需重新打开。", style = MaterialTheme.typography.labelSmall, color = palette.muted)
                    }
                    Switch(checked = background, onCheckedChange = { repo.setBackground(it) })
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlineButton("刷新", modifier = Modifier.weight(1f), icon = JarvisIcons.Refresh) { repo.refresh() }
                    OutlineButton("系统状态", modifier = Modifier.weight(1f), icon = JarvisIcons.System) { onOpenSystem() }
                }
            }
        }

        FamilyServicesSection(
            providers = providers,
            selectedProvider = provider,
            providerMenu = providerMenu,
            onProviderMenu = { providerMenu = it },
            onSelectProvider = { account.selectProvider(it) },
            label = label,
            onLabel = { label = it },
            secret = secret,
            onSecret = { secret = it },
            credentials = credentials,
            statuses = credentialStatus,
            onSave = {
                account.saveCredential(provider, label.trim(), secret)
                label = ""; secret = ""
            },
            onTest = { id -> account.verifyCredential(id) },
            onRevoke = { account.revokeCredential(it) },
            onRefresh = { account.refreshCredentials() },
            notice = notice,
        )

        if (isAdmin) {
            JarvisCard(padding = 16.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SectionHeading("Jarvis 用户", eyebrow = "USERS", subtitle = "邀请成员、调整角色与能力。第一个账户自动成为管理员。")
                    if (users.isEmpty() && loading) LoadingLine("正在读取用户管理…")
                    users.forEach { member ->
                        val id = member.str("id")
                        val isSelf = id == user?.str("id")
                        Column(
                            Modifier.fillMaxWidth()
                                .background(palette.surface2, RoundedCornerShape(13.dp))
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(9.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(member.str("username"), style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                                    Text(
                                        "${if (member.str("role") == "admin") "管理员" else "成员"} · " +
                                            "${member["active_sessions"]?.jsonPrimitive?.intOrNull ?: 0} 个活跃会话 · 注册于 ${relativeTime(member.str("created_at"))}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = palette.muted,
                                    )
                                }
                                Box {
                                    Surface(
                                        onClick = { if (!isSelf) roleMenuFor = if (roleMenuFor == id) null else id },
                                        shape = CircleShape,
                                        color = palette.surface3,
                                    ) {
                                        Text(
                                            if (member.str("role") == "admin") "管理员" else "成员",
                                            Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
                                            style = MaterialTheme.typography.labelMedium,
                                            color = if (isSelf) palette.muted else palette.accent,
                                        )
                                    }
                                    DropdownMenu(roleMenuFor == id, onDismissRequest = { roleMenuFor = null }) {
                                        listOf("member" to "成员", "admin" to "管理员").forEach { (value, text) ->
                                            DropdownMenuItem(
                                                text = { Text(text) },
                                                onClick = {
                                                    roleMenuFor = null
                                                    runCatching { account.changeRole(id, value) }
                                                },
                                            )
                                        }
                                    }
                                }
                            }
                            if (member.str("role") == "member") {
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    capabilityLabels.entries.take(5).forEach { (capability, text) ->
                                        val allowed = (capabilities[id] ?: emptyList()).contains(capability)
                                        Surface(
                                            onClick = { account.changeCapability(id, capability, !allowed) },
                                            shape = CircleShape,
                                            color = if (allowed) palette.accentSoft else palette.surface,
                                            border = androidx.compose.foundation.BorderStroke(1.dp, if (allowed) palette.accent.copy(alpha = 0.4f) else palette.line),
                                        ) {
                                            Row(Modifier.padding(horizontal = 9.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                                                Icon(if (allowed) JarvisIcons.Check else JarvisIcons.Plus, null, Modifier.size(11.dp), tint = if (allowed) palette.accent else palette.muted2)
                                                Spacer(Modifier.width(4.dp))
                                                Text(text, style = MaterialTheme.typography.labelSmall, color = if (allowed) palette.accent else palette.muted, maxLines = 1)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Divider()
                    Text("邀请成员", style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                    Text("生成一次性邀请令牌；成员用令牌设置密码，之后只用用户名和密码登录。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = inviteName,
                            onValueChange = { inviteName = it.take(80) },
                            placeholder = { Text("成员用户名", style = MaterialTheme.typography.bodySmall) },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(11.dp),
                            textStyle = MaterialTheme.typography.bodySmall,
                        )
                        PrimaryButton("创建邀请", enabled = inviteName.trim().length >= 3) { account.createInvite(inviteName) }
                    }
                    inviteToken?.let { token ->
                        Row(
                            Modifier.fillMaxWidth()
                                .background(palette.accentSoft, RoundedCornerShape(11.dp))
                                .padding(11.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                token,
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                color = palette.accent,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            TextButton(onClick = { clipboard.setText(AnnotatedString(token)) }) { Text("复制", color = palette.accent) }
                        }
                    }
                }
            }
        }

        JarvisCard(padding = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(11.dp)) {
                SectionHeading("登录会话", eyebrow = "SESSIONS", subtitle = "可以撤销其他设备的登录。")
                if (sessions.isEmpty()) {
                    Text("暂无会话信息。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                } else {
                    val currentSession = me?.str("session_id")
                    sessions.forEach { session ->
                        val isCurrent = session.str("id") == currentSession
                        Row(
                            Modifier.fillMaxWidth()
                                .background(palette.surface2, RoundedCornerShape(11.dp))
                                .padding(horizontal = 12.dp, vertical = 9.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(if (isCurrent) "当前设备" else "其他设备", style = MaterialTheme.typography.bodySmall, color = palette.text)
                                Text(
                                    session.str("last_seen_at").takeIf { it.isNotBlank() }?.let { "最近活动：${relativeTime(it)}" } ?: "—",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = palette.muted,
                                )
                            }
                            if (isCurrent) StatusBadge("当前", palette.sage)
                            else TextButton(onClick = { account.revokeSession(session.str("id")) }) {
                                Text("撤销", color = palette.danger, style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                }
                OutlineButton("退出登录", Modifier.fillMaxWidth(), icon = JarvisIcons.Logout) { onLogout() }
            }
        }

        JarvisCard(padding = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(11.dp)) {
                SectionHeading("开发者", eyebrow = "DEVELOPER", subtitle = "面向诊断与集成调试。")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("显示开发者入口", style = MaterialTheme.typography.titleSmall, color = palette.text)
                        Text("显示「系统」与「Hermes」，并展示原始执行数据。", style = MaterialTheme.typography.labelSmall, color = palette.muted)
                    }
                    Switch(checked = developer, onCheckedChange = onDeveloperChange)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlineButton("Hermes 控制台", Modifier.weight(1f), icon = JarvisIcons.Sparkle) { onOpenHermes() }
                    OutlineButton("系统与用量", Modifier.weight(1f), icon = JarvisIcons.System) { onOpenSystem() }
                }
            }
        }

        JarvisCard(padding = 16.dp, color = palette.surface2) {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Eyebrow("ABOUT JARVIS")
                Text("Jarvis 0.4.2 · Your Personal AI Cloud", style = MaterialTheme.typography.bodySmall, color = palette.text)
                Text("数据、身份与会话留在你的私人云。Android 端与 Web 共享协议与状态。", style = MaterialTheme.typography.labelSmall, color = palette.muted)
                Text("GPL-3.0-or-later · More Life. Less Work.", style = MaterialTheme.typography.labelSmall, color = palette.muted2)
            }
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun AppearanceSection(
    light: Boolean,
    style: JarvisStyle,
    onToggleLight: (Boolean) -> Unit,
    onStyleChange: (JarvisStyle) -> Unit,
) {
    val palette = jarvisColors()
    JarvisCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            SectionHeading("外观", eyebrow = "APPEARANCE", subtitle = "立即生效 · 保存在当前设备。明暗模式可独立切换。")
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                JarvisStyle.entries.toList().chunked(2).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        row.forEach { item ->
                            val preview = jarvisPalette(item, light)
                            val selected = style == item
                            Column(
                                Modifier.weight(1f)
                                    .background(if (selected) palette.accentSoft else preview.surface, RoundedCornerShape(15.dp))
                                    .border(1.dp, if (selected) palette.accent.copy(alpha = 0.55f) else palette.line, RoundedCornerShape(15.dp))
                                    .clickable { onStyleChange(item) }
                                    .padding(11.dp),
                                verticalArrangement = Arrangement.spacedBy(7.dp),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        Modifier.size(30.dp)
                                            .background(
                                                Brush.radialGradient(preview.orb),
                                                CircleShape,
                                            ),
                                    )
                                    Spacer(Modifier.weight(1f))
                                    if (selected) Icon(JarvisIcons.Check, null, Modifier.size(14.dp), tint = palette.accent)
                                }
                                Text(item.label, style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                                Text(item.caption, style = MaterialTheme.typography.labelSmall, color = palette.muted)
                            }
                        }
                        if (row.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().background(palette.surface2, RoundedCornerShape(12.dp)).padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                listOf(false to "深色", true to "浅色").forEach { (value, text) ->
                    val selected = light == value
                    Surface(
                        onClick = { onToggleLight(value) },
                        shape = RoundedCornerShape(9.dp),
                        color = if (selected) palette.surface else Color.Transparent,
                        modifier = Modifier.weight(1f),
                    ) {
                        Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (value) JarvisIcons.Sun else JarvisIcons.Moon, null, Modifier.size(14.dp), tint = if (selected) palette.accent else palette.muted)
                            Spacer(Modifier.width(5.dp))
                            Text(text, style = MaterialTheme.typography.labelMedium, color = if (selected) palette.textStrong else palette.muted)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FamilyServicesSection(
    providers: List<cloud.jarvis.app.ProviderOption>,
    selectedProvider: String,
    providerMenu: Boolean,
    onProviderMenu: (Boolean) -> Unit,
    onSelectProvider: (String) -> Unit,
    label: String,
    onLabel: (String) -> Unit,
    secret: String,
    onSecret: (String) -> Unit,
    credentials: List<JsonObject>,
    statuses: Map<String, String>,
    onSave: () -> Unit,
    onTest: (String) -> Unit,
    onRevoke: (String) -> Unit,
    onRefresh: () -> Unit,
    notice: String?,
) {
    val palette = jarvisColors()
    val provider = providers.firstOrNull { it.credentialProvider == selectedProvider } ?: providers.firstOrNull()
    JarvisCard(padding = 16.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(11.dp)) {
            SectionHeading("家庭服务链接", eyebrow = "INTEGRATIONS", subtitle = "在服务中创建只读凭据，再粘贴到这里。", action = "刷新", onAction = onRefresh)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    Surface(
                        onClick = { onProviderMenu(true) },
                        shape = RoundedCornerShape(11.dp),
                        color = palette.surface2,
                        border = androidx.compose.foundation.BorderStroke(1.dp, palette.line),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(provider?.name ?: "选择服务", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = palette.text)
                            Icon(JarvisIcons.ChevronDown, null, Modifier.size(14.dp), tint = palette.muted)
                        }
                    }
                    DropdownMenu(providerMenu, onDismissRequest = { onProviderMenu(false) }) {
                        providers.forEach { item ->
                            DropdownMenuItem(
                                text = { Text(item.name) },
                                onClick = { onSelectProvider(item.credentialProvider); onProviderMenu(false) },
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = label,
                    onValueChange = { onLabel(it.take(120)) },
                    placeholder = { Text("连接标签（可选）", style = MaterialTheme.typography.bodySmall) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(11.dp),
                    textStyle = MaterialTheme.typography.bodySmall,
                )
            }
            OutlinedTextField(
                value = secret,
                onValueChange = { if (it.length <= 16384) onSecret(it) },
                placeholder = { Text("只读服务凭据（会话型应用填 用户名:密码）", style = MaterialTheme.typography.bodySmall) },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(11.dp),
                textStyle = MaterialTheme.typography.bodySmall,
            )
            notice?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = palette.muted) }
            PrimaryButton("保存并验证", Modifier.fillMaxWidth(), enabled = secret.isNotBlank()) { onSave() }
            if (credentials.isEmpty()) {
                Text("尚未配置家庭服务连接。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
            } else {
                credentials.forEach { item ->
                    val status = statuses[item.str("id")]
                    Row(
                        Modifier.fillMaxWidth()
                            .background(palette.surface2, RoundedCornerShape(11.dp))
                            .padding(horizontal = 12.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                providers.firstOrNull { it.credentialProvider == item.str("provider") }?.name ?: item.str("provider"),
                                style = MaterialTheme.typography.bodySmall,
                                color = palette.text,
                            )
                            Text(
                                item.str("label").ifBlank { "Jarvis 服务连接" } + " · " + when (status) {
                                    "connected" -> "连接已验证"
                                    "failed" -> "已保存，验证失败"
                                    "testing" -> "正在验证连接…"
                                    else -> "已加密保存"
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = when (status) {
                                    "connected" -> palette.sage
                                    "failed" -> palette.danger
                                    else -> palette.muted
                                },
                            )
                        }
                        TextButton(onClick = { onTest(item.str("id")) }) { Text("测试", color = palette.accent, style = MaterialTheme.typography.labelSmall) }
                        TextButton(onClick = { onRevoke(item.str("id")) }) { Text("撤销", color = palette.danger, style = MaterialTheme.typography.labelSmall) }
                    }
                }
            }
        }
    }
}
