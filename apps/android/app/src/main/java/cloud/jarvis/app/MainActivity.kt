package cloud.jarvis.app

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import cloud.jarvis.app.designsystem.*
import cloud.jarvis.app.features.*
import cloud.jarvis.app.voice.VoiceCallScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        (application as JarvisApplication).repository.handleDeepLink(intent)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        setContent {
            val repository = (application as JarvisApplication).repository
            var light by remember { mutableStateOf(repository.preferences.light) }
            var style by remember { mutableStateOf(repository.preferences.style) }
            var developer by remember { mutableStateOf(repository.preferences.developer) }
            SideEffect {
                val barStyle = if (light) {
                    SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                } else {
                    SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                }
                enableEdgeToEdge(statusBarStyle = barStyle, navigationBarStyle = barStyle)
            }
            JarvisTheme(light = light, style = style) {
                JarvisBackground {
                    JarvisRoot(
                        repo = repository,
                        light = light,
                        style = style,
                        onToggleLight = { value -> light = value; repository.preferences.light = value },
                        onStyleChange = { value -> style = value; repository.preferences.style = value },
                        developer = developer,
                        onDeveloperChange = { value -> developer = value; repository.preferences.developer = value },
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        (application as JarvisApplication).repository.handleDeepLink(intent)
    }
}

@Composable
private fun JarvisRoot(
    repo: JarvisRepository,
    light: Boolean,
    style: JarvisStyle,
    onToggleLight: (Boolean) -> Unit,
    onStyleChange: (JarvisStyle) -> Unit,
    developer: Boolean,
    onDeveloperChange: (Boolean) -> Unit,
) {
    val paired by repo.paired.collectAsStateWithLifecycle()
    val connection by repo.gateway.state.collectAsStateWithLifecycle()
    val error by repo.error.collectAsStateWithLifecycle()
    var voiceOpen by remember { mutableStateOf(false) }
    var logoutConfirm by remember { mutableStateOf(false) }
    var notificationAsked by remember { mutableStateOf(false) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(paired, connection) {
        if (paired && connection == ConnectionState.online && Build.VERSION.SDK_INT >= 33 && !notificationAsked) {
            notificationAsked = true
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    if (!paired || connection == ConnectionState.unauthorized) {
        AuthScreen(repo)
        return
    }
    val nav = rememberNavController()
    Box(Modifier.fillMaxSize()) {
        JarvisShell(
            repo = repo,
            nav = nav,
            light = light,
            style = style,
            developer = developer,
            connection = connection,
            error = error,
            onErrorDismiss = { repo.error.value = null },
            onVoice = { voiceOpen = true },
            onToggleLight = onToggleLight,
            onStyleChange = onStyleChange,
            onDeveloperChange = onDeveloperChange,
            onLogout = { logoutConfirm = true },
            modifier = if (voiceOpen) Modifier.clearAndSetSemantics { } else Modifier,
        )
        if (voiceOpen) {
            VoiceCallScreen(repo.m2) { conversationId ->
                voiceOpen = false
                if (conversationId != null) {
                    repo.m2.selectConversation(conversationId)
                    nav.navigate("conversation/$conversationId") { launchSingleTop = true }
                }
            }
        }
    }
    if (logoutConfirm) {
        AlertDialog(
            onDismissRequest = { logoutConfirm = false },
            title = { Text("退出登录") },
            text = { Text("退出后本机的会话缓存会被清除，任务与对话仍保存在私人云中。") },
            confirmButton = {
                TextButton(onClick = { logoutConfirm = false; repo.logout() }) {
                    Text("退出", color = jarvisColors().danger)
                }
            },
            dismissButton = { TextButton(onClick = { logoutConfirm = false }) { Text("取消") } },
        )
    }
}

private data class NavItem(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val developerOnly: Boolean = false)

private val allNavItems = listOf(
    NavItem("home", "首页", JarvisIcons.Home),
    NavItem("spaces", "空间", JarvisIcons.Spaces),
    NavItem("apps", "应用", JarvisIcons.Apps),
    NavItem("tasks", "任务", JarvisIcons.Tasks),
    NavItem("jarvis", "Jarvis", JarvisIcons.Jarvis),
    NavItem("agents", "Hermes", JarvisIcons.Sparkle, developerOnly = true),
    NavItem("system", "系统", JarvisIcons.System, developerOnly = true),
    NavItem("settings", "设置", JarvisIcons.Settings),
)

private val bottomItems = listOf("home", "spaces", "jarvis", "tasks", "apps")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun JarvisShell(
    repo: JarvisRepository,
    nav: NavHostController,
    light: Boolean,
    style: JarvisStyle,
    developer: Boolean,
    connection: ConnectionState,
    error: String?,
    onErrorDismiss: () -> Unit,
    onVoice: () -> Unit,
    onToggleLight: (Boolean) -> Unit,
    onStyleChange: (JarvisStyle) -> Unit,
    onDeveloperChange: (Boolean) -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = jarvisColors()
    val context = LocalContext.current
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route ?: "home"
    val notifications by repo.m2.notifications.collectAsStateWithLifecycle()
    val unread = notifications.count { it.str("read_at").isBlank() }
    val background by repo.backgroundEnabled.collectAsStateWithLifecycle()
    val savedAt by repo.savedAt.collectAsStateWithLifecycle()
    val deepLink by repo.deepLink.collectAsStateWithLifecycle()
    var notificationPopup by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(error) {
        if (error != null) snackbarHostState.showSnackbar(error)
    }

    fun navigate(routeValue: String, topLevel: Boolean = false) {
        if (routeValue == route) return
        if (topLevel) {
            nav.navigate(routeValue) {
                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        } else {
            nav.navigate(routeValue) { launchSingleTop = true }
        }
        scope.launch { drawerState.close() }
    }

    val openWorkspace = {
        nav.navigate("workspace") { launchSingleTop = true }
    }
    val openRun: (String) -> Unit = { id ->
        nav.navigate("run/$id") { launchSingleTop = true }
    }

    LaunchedEffect(deepLink, connection) {
        val target = deepLink
        if (target != null && connection == ConnectionState.online) {
            when {
                target.startsWith("workspace/") -> {
                    val id = target.removePrefix("workspace/")
                    repo.m2.openWorkspaceById(id)
                    nav.navigate("workspace") { launchSingleTop = true }
                }
                target.startsWith("conversation/") -> {
                    val id = target.removePrefix("conversation/")
                    repo.m2.selectConversation(id)
                    nav.navigate("conversation/$id") { launchSingleTop = true }
                }
                else -> nav.navigate(target) { launchSingleTop = true }
            }
            repo.consumeDeepLink()
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = !route.startsWith("conversation/") && route != "jarvis",
        drawerContent = {
            ModalDrawerSheet(
                drawerContainerColor = palette.surface,
                modifier = Modifier.width(310.dp),
            ) {
                Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        JarvisOrb(42.dp)
                        Spacer(Modifier.width(11.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                            Text("JARVIS", style = MaterialTheme.typography.titleLarge.copy(letterSpacing = 3.sp), color = palette.textStrong)
                            Eyebrow("YOUR PERSONAL AI CLOUD")
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(
                        Modifier.fillMaxWidth()
                            .background(palette.surface2, RoundedCornerShape(12.dp))
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier.size(6.dp).background(
                                if (connection == ConnectionState.online) palette.sage else palette.danger,
                                CircleShape,
                            ),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            when (connection) {
                                ConnectionState.online -> "已连接"
                                ConnectionState.connecting -> "连接中"
                                ConnectionState.reconnecting -> "重连中"
                                ConnectionState.unauthorized -> "请重新登录"
                                else -> "离线 · 显示缓存"
                            },
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.bodySmall,
                            color = palette.muted,
                        )
                        if (connection != ConnectionState.online) {
                            TextButton(onClick = { repo.refresh() }, contentPadding = PaddingValues(0.dp)) {
                                Text("重试", color = palette.accent, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    allNavItems.filter { !it.developerOnly || developer }.forEach { item ->
                        val selected = route == item.route || (item.route == "tasks" && route.startsWith("run/")) ||
                            (item.route == "jarvis" && (route.startsWith("conversation/") || route in listOf("workspace", "jarvis")))
                        Row(
                            Modifier.fillMaxWidth()
                                .clip(RoundedCornerShape(11.dp))
                                .background(if (selected) palette.accentSoft else Color.Transparent)
                                .clickable { navigate(item.route, topLevel = true) }
                                .padding(horizontal = 12.dp, vertical = 11.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(item.icon, null, Modifier.size(18.dp), tint = if (selected) palette.accent else palette.muted)
                            Spacer(Modifier.width(12.dp))
                            Text(item.label, style = MaterialTheme.typography.bodyMedium, color = if (selected) palette.textStrong else palette.muted)
                            if (item.route == "jarvis" && selected) {
                                Spacer(Modifier.weight(1f))
                                Box(Modifier.width(2.dp).height(14.dp).background(palette.accent, CircleShape))
                            }
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    HorizontalDivider(color = palette.line)
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column {
                            Text("后台连接", style = MaterialTheme.typography.bodySmall, color = palette.text)
                            Text("常驻通知保持实时", style = MaterialTheme.typography.labelSmall, color = palette.muted2)
                        }
                        Switch(checked = background, onCheckedChange = { repo.setBackground(it) })
                    }
                    Row(
                        Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { onToggleLight(!light) }
                            .padding(horizontal = 10.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(if (light) JarvisIcons.Moon else JarvisIcons.Sun, null, Modifier.size(17.dp), tint = palette.muted)
                        Spacer(Modifier.width(9.dp))
                        Text(if (light) "切换到深色外观" else "切换到浅色外观", style = MaterialTheme.typography.bodySmall, color = palette.muted)
                    }
                    if (savedAt != null && connection != ConnectionState.online) {
                        Text("缓存于 ${fullDateTime(java.time.Instant.ofEpochMilli(savedAt!!).toString())}", style = MaterialTheme.typography.labelSmall, color = palette.muted2)
                    }
                    Row(
                        Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { onLogout() }
                            .padding(horizontal = 10.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(JarvisIcons.Logout, null, Modifier.size(17.dp), tint = palette.danger)
                        Spacer(Modifier.width(9.dp))
                        Text("退出登录", style = MaterialTheme.typography.bodySmall, color = palette.danger)
                    }
                    Spacer(Modifier.height(20.dp))
                }
            }
        },
    ) {
        Scaffold(
            modifier = modifier.fillMaxSize(),
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            topBar = {
                Column {
                    Row(
                        Modifier.fillMaxWidth()
                            .background(palette.background.copy(alpha = 0.88f))
                            .statusBarsPadding()
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Surface(onClick = { scope.launch { drawerState.open() } }, shape = CircleShape, color = Color.Transparent, modifier = Modifier.size(38.dp)) {
                            Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Menu, "打开菜单", Modifier.size(20.dp), tint = palette.muted) }
                        }
                        Spacer(Modifier.width(4.dp))
                        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                            Text("◈", color = palette.accent, fontSize = 14.sp)
                            Spacer(Modifier.width(6.dp))
                            Text("JARVIS", style = MaterialTheme.typography.labelLarge.copy(letterSpacing = 2.6.sp), color = palette.textStrong)
                            Spacer(Modifier.width(9.dp))
                            Box(
                                Modifier.size(5.dp).background(
                                    if (connection == ConnectionState.online) palette.sage else palette.danger,
                                    CircleShape,
                                ),
                            )
                        }
                        Surface(onClick = onVoice, shape = CircleShape, color = Color.Transparent, modifier = Modifier.size(38.dp)) {
                            Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Mic, "语音通话", Modifier.size(18.dp), tint = palette.accent) }
                        }
                        Box {
                            Surface(onClick = { notificationPopup = !notificationPopup }, shape = CircleShape, color = Color.Transparent, modifier = Modifier.size(38.dp)) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(JarvisIcons.Bell, "通知", Modifier.size(18.dp), tint = palette.muted)
                                    if (unread > 0) {
                                        Box(
                                            Modifier.align(Alignment.TopEnd).padding(top = 7.dp, end = 6.dp)
                                                .size(7.dp).background(palette.danger, CircleShape),
                                        )
                                    }
                                }
                            }
                            DropdownMenu(
                                expanded = notificationPopup,
                                onDismissRequest = { notificationPopup = false },
                                modifier = Modifier.widthIn(max = 340.dp).background(palette.surface),
                            ) {
                                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text("通知", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = palette.textStrong)
                                    TextButton(onClick = { notificationPopup = false; navigate("notifications", topLevel = false) }) {
                                        Text("全部", color = palette.accent, style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                                if (notifications.isEmpty()) {
                                    Text("暂无通知", Modifier.padding(horizontal = 14.dp, vertical = 20.dp), style = MaterialTheme.typography.bodySmall, color = palette.muted)
                                } else {
                                    notifications.take(4).forEach { notification ->
                                        Row(
                                            Modifier.fillMaxWidth()
                                                .clickable {
                                                    notificationPopup = false
                                                    repo.m2.markNotificationRead(notification.str("id"))
                                                    val reference = notification.str("reference_id")
                                                    when (notification.str("kind")) {
                                                        "task_completed", "task_failed", "task_question" -> fromNotification(openRun, reference)
                                                        "question" -> navigate("conversation/$reference", topLevel = false)
                                                        else -> navigate("notification/${notification.str("id")}", topLevel = false)
                                                    }
                                                }
                                                .padding(horizontal = 14.dp, vertical = 10.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Box(
                                                Modifier.size(6.dp).background(
                                                    if (notification.str("read_at").isBlank()) palette.accent else palette.muted2,
                                                    CircleShape,
                                                ),
                                            )
                                            Spacer(Modifier.width(9.dp))
                                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                Text(notification.str("title"), style = MaterialTheme.typography.bodySmall, color = palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                Text(notification.str("body"), style = MaterialTheme.typography.labelSmall, color = palette.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Surface(onClick = { navigate("settings", topLevel = true) }, shape = CircleShape, color = Color.Transparent, modifier = Modifier.size(38.dp)) {
                            Box(contentAlignment = Alignment.Center) { Icon(JarvisIcons.Settings, "设置", Modifier.size(18.dp), tint = palette.muted) }
                        }
                    }
                    if (connection != ConnectionState.online) {
                        Text(
                            "显示最近缓存 · 正在恢复连接",
                            Modifier.fillMaxWidth().background(palette.surface2).padding(horizontal = 16.dp, vertical = 3.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = palette.muted,
                        )
                    }
                    HorizontalDivider(color = palette.line)
                }
            },
            bottomBar = {
                NavigationBar(
                    containerColor = palette.background.copy(alpha = 0.94f),
                    tonalElevation = 0.dp,
                    modifier = Modifier.navigationBarsPadding(),
                ) {
                    listOf("home", "spaces", "jarvis", "tasks", "apps").forEach { key ->
                        val item = allNavItems.first { it.route == key }
                        val selected = route == key || (key == "jarvis" && (route.startsWith("conversation/") || route == "workspace")) || (key == "tasks" && route.startsWith("run/"))
                        NavigationBarItem(
                            selected = selected,
                            onClick = { navigate(key, topLevel = true) },
                            icon = {
                                if (key == "jarvis") {
                                    Box(Modifier.alpha(if (selected) 1f else 0.42f)) {
                                        JarvisOrb(27.dp, mode = OrbMode.Idle, animated = selected)
                                    }
                                } else {
                                    Icon(item.icon, item.label, Modifier.size(21.dp), tint = if (selected) palette.accent else palette.muted)
                                }
                            },
                            label = { Text(item.label, style = MaterialTheme.typography.labelSmall, color = if (selected) palette.accent else palette.muted) },
                            colors = NavigationBarItemDefaults.colors(
                                indicatorColor = Color.Transparent,
                                selectedIconColor = palette.accent,
                                selectedTextColor = palette.accent,
                                unselectedIconColor = palette.muted,
                                unselectedTextColor = palette.muted,
                            ),
                        )
                    }
                }
            },
            snackbarHost = {
                SnackbarHost(hostState = snackbarHostState) { data ->
                    Snackbar(
                        containerColor = palette.surface3,
                        contentColor = palette.text,
                        action = {
                            TextButton(onClick = onErrorDismiss) { Text("关闭", color = palette.accent) }
                        },
                    ) { Text(data.visuals.message) }
                }
            },
        ) { padding ->
            NavHost(
                navController = nav,
                startDestination = "home",
                modifier = Modifier.padding(padding),
            ) {
                composable("home") {
                    ProductHome(
                        repo = repo,
                        navigate = { navigate(it, topLevel = it in bottomItems || it in listOf("agents", "system", "settings")) },
                        onVoice = onVoice,
                        onOpenHermes = { navigate("hermes", topLevel = false) },
                        openApp = { id -> repo.m2.openApp(id, context) },
                    )
                }
                composable("spaces") {
                    SpacesPage(
                        repo = repo,
                        navigate = { navigate(it, topLevel = it in bottomItems) },
                        openApp = { id -> repo.m2.openApp(id, context) },
                    )
                }
                composable("space/{id}") { entry ->
                    SpaceDetail(entry.arguments?.getString("id").orEmpty()) { navigate(it, topLevel = it in bottomItems) }
                }
                composable("apps") {
                    AppsPage(
                        repo = repo,
                        openApp = { id -> repo.m2.openApp(id, context) },
                        ask = { repo.m2.askAboutApp(it); navigate("jarvis", topLevel = true) },
                    )
                }
                composable("app/{id}") { entry ->
                    AppsPage(
                        repo = repo,
                        openApp = { appId -> repo.m2.openApp(appId, context) },
                        ask = { repo.m2.askAboutApp(it); navigate("jarvis", topLevel = true) },
                        initialApp = entry.arguments?.getString("id"),
                    )
                }
                composable("tasks") {
                    ProductTasks(repo, openRun)
                }
                composable("run/{id}") { entry ->
                    val id = entry.arguments?.getString("id").orEmpty()
                    LaunchedEffect(id) { repo.m2.openRun(id) }
                    DynamicScreen(repo.m2) { id -> nav.navigate("run/$id") { launchSingleTop = true } }
                }
                composable("jarvis") {
                    ConversationScreen(
                        repo = repo.m2,
                        openRun = openRun,
                        openView = { id -> repo.m2.loadView(id); openWorkspace() },
                        openWorkspace = openWorkspace,
                        onVoice = onVoice,
                        developer = developer,
                    )
                }
                composable("conversation/{id}") { entry ->
                    val id = entry.arguments?.getString("id").orEmpty()
                    LaunchedEffect(id) { repo.m2.selectConversation(id) }
                    ConversationScreen(
                        repo = repo.m2,
                        openRun = openRun,
                        openView = { viewId -> repo.m2.loadView(viewId); openWorkspace() },
                        openWorkspace = openWorkspace,
                        onVoice = onVoice,
                        developer = developer,
                    )
                }
                composable("workspace") {
                    WorkspaceScreen(repo.m2, back = { nav.popBackStack() }, developer = developer)
                }
                composable("notifications") {
                    NotificationCenter(repo) { target -> navigate(target, topLevel = false) }
                }
                composable("notification/{id}") { entry ->
                    NotificationDetail(repo, entry.arguments?.getString("id").orEmpty(), openRun) { nav.popBackStack() }
                }
                composable("settings") {
                    SettingsScreen(
                        repo = repo,
                        light = light,
                        style = style,
                        onToggleLight = onToggleLight,
                        onStyleChange = onStyleChange,
                        developer = developer,
                        onDeveloperChange = onDeveloperChange,
                        onOpenHermes = { navigate("hermes", topLevel = false) },
                        onOpenSystem = { navigate("system", topLevel = true) },
                        onLogout = onLogout,
                    )
                }
                composable("agents") {
                    HermesCenterScreen(repo, openRun, { navigate("hermes", topLevel = false) }, { navigate("system", topLevel = true) })
                }
                composable("system") {
                    SystemScreen(repo, openRun)
                }
                composable("hermes") {
                    HermesWebViewScreen(repo.gateway) { nav.popBackStack() }
                }
            }
        }
    }
}

private fun fromNotification(openRun: (String) -> Unit, reference: String) {
    openRun(reference)
}

@Composable
private fun SpacesPage(repo: JarvisRepository, navigate: (String) -> Unit, openApp: (String) -> Unit) {
    val palette = jarvisColors()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Eyebrow("SPACES")
            Text("我的空间", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
            Text("你的文件、照片与想法，汇聚一处。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
        }
        SpaceTiles(navigate = navigate, openApp = openApp)
        EmptyState("选择你想探索的空间", "照片与家庭使用原应用完整界面；其他空间将在接入后开放。")
        Spacer(Modifier.height(26.dp))
    }
}

@Composable
private fun AppsPage(repo: JarvisRepository, openApp: (String) -> Unit, ask: (String) -> Unit, initialApp: String? = null) {
    val palette = jarvisColors()
    val applications by repo.m2.applications.collectAsStateWithLifecycle()
    val catalog by repo.m2.catalog.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { repo.m2.refreshApplications() }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Eyebrow("CASAOS APPLICATION CENTER")
                Text("应用", style = MaterialTheme.typography.headlineSmall, color = palette.textStrong)
                Text("已安装、运行与 Jarvis 连接状态。", style = MaterialTheme.typography.bodySmall, color = palette.muted)
            }
            OutlineButton("刷新", icon = JarvisIcons.Refresh) { repo.m2.refreshApplications() }
        }
        ProductApplications(
            value = applications,
            refresh = { repo.m2.refreshApplications() },
            openApp = openApp,
            askApp = ask,
            catalog = catalog,
            account = repo.account,
            initialApp = initialApp,
        )
        Spacer(Modifier.height(26.dp))
    }
}

@Composable
private fun AuthScreen(repo: JarvisRepository) {
    val palette = jarvisColors()
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf("login") }
    var server by remember { mutableStateOf(repo.preferences.lastServer) }
    var username by remember { mutableStateOf(repo.preferences.lastUsername) }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var invite by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var registrationOpen by remember { mutableStateOf<Boolean?>(null) }
    var localError by remember { mutableStateOf<String?>(null) }
    val error by repo.error.collectAsStateWithLifecycle()

    LaunchedEffect(mode, server) {
        if (mode == "register" && server.isNotBlank()) {
            registrationOpen = repo.registrationOpen(server)
        }
    }
    LaunchedEffect(error, submitting) {
        if (error != null) submitting = false
    }

    fun submit() {
        if (submitting) return
        focus.clearFocus()
        localError = null
        submitting = true
        when (mode) {
            "register" -> {
                if (password != confirmation) { localError = "两次输入的密码不一致"; submitting = false; return }
                repo.register(server, username, password, confirmation)
            }
            "invite" -> repo.acceptInvite(server, invite, password)
            else -> repo.login(server, username, password)
        }
        scope.launch { delay(3000); if (submitting) submitting = false }
    }

    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(46.dp))
        JarvisOrb(92.dp, mode = OrbMode.Idle)
        Spacer(Modifier.height(18.dp))
        Eyebrow("YOUR PERSONAL CLOUD")
        Spacer(Modifier.height(6.dp))
        Text(
            when (mode) { "register" -> "注册 Jarvis"; "invite" -> "接受管理员邀请"; else -> "登录 Jarvis" },
            style = MaterialTheme.typography.displaySmall,
            color = palette.textStrong,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(5.dp))
        Text(
            when (mode) {
                "register" -> if (registrationOpen == true) "这是 Jarvis 账户注册，不需要 Authentik 或配对码。第一个注册者自动成为管理员。" else "第一个 Jarvis 账户已经注册。请返回登录，或使用管理员发放的邀请加入。"
                "invite" -> "管理员创建邀请后，把邀请令牌发给你；在这里设置 Jarvis 密码。"
                else -> "使用 Jarvis 用户名和密码登录。手机与服务器加入同一个 Tailscale 网络。"
            },
            style = MaterialTheme.typography.bodySmall,
            color = palette.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Spacer(Modifier.height(24.dp))
        JarvisCard(padding = 18.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = server,
                    onValueChange = { server = it; localError = null },
                    label = { Text("服务器地址") },
                    placeholder = { Text("http://100.x.x.x:8080", style = MaterialTheme.typography.bodySmall) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                )
                if (mode == "invite") {
                    OutlinedTextField(
                        value = invite,
                        onValueChange = { invite = it },
                        label = { Text("邀请令牌") },
                        placeholder = { Text("管理员发来的邀请令牌") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    )
                } else {
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text("用户名") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    )
                }
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(if (mode == "invite") "设置密码" else "密码") },
                    placeholder = { Text(if (mode == "login") "密码（至少 8 位）" else "设置密码（至少 8 位）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        TextButton(onClick = { showPassword = !showPassword }, contentPadding = PaddingValues(horizontal = 6.dp)) {
                            Text(if (showPassword) "隐藏" else "显示", style = MaterialTheme.typography.labelSmall, color = palette.muted)
                        }
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (mode == "register") ImeAction.Next else ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                )
                if (mode == "register") {
                    OutlinedTextField(
                        value = confirmation,
                        onValueChange = { confirmation = it },
                        label = { Text("确认密码") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                    )
                }
                (localError ?: error)?.let { message ->
                    Text(message, color = palette.danger, style = MaterialTheme.typography.bodySmall)
                }
                PrimaryButton(
                    text = when (mode) { "register" -> "注册并登录"; "invite" -> "接受邀请并登录"; else -> "登录" },
                    modifier = Modifier.fillMaxWidth(),
                    loading = submitting,
                    enabled = server.isNotBlank() && password.isNotBlank() &&
                        (mode == "invite" && invite.isNotBlank() || mode != "invite" && username.isNotBlank()) &&
                        (mode != "register" || registrationOpen == true),
                    onClick = { submit() },
                )
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
            listOf("login" to "登录", "register" to "首次注册", "invite" to "管理员邀请").forEach { (value, text) ->
                val selected = mode == value
                Surface(
                    onClick = { mode = value; localError = null; repo.error.value = null },
                    shape = CircleShape,
                    color = if (selected) palette.accentSoft else Color.Transparent,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(
                        text,
                        Modifier.padding(vertical = 8.dp),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (selected) palette.accent else palette.muted2,
                    )
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "More Life. Less Work.",
            style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 2.sp),
            color = palette.muted2,
        )
        Spacer(Modifier.height(30.dp))
    }
}
