import type { HttpAuth } from "./manifest.js";

/**
 * How to connect a known self-hosted application.
 *
 * A recipe is *data*, not an adapter. It tells the catalog which auth mode an
 * app uses, where its API key is created, which read/write operations are safe
 * to expose, and how to prove the connection works. Adding an app therefore
 * means adding a recipe entry, not a new provider, a new MCP server, or a code
 * path in the capability bridge.
 */
export type RecipeOperation = {
  name: string;
  description?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  read_only?: boolean;
  body_format?: "json" | "form";
  params?: Array<{
    name: string;
    in?: "path" | "query" | "body";
    required?: boolean;
    type?: "string" | "number" | "boolean";
    description?: string;
  }>;
};

export type RecipeAuth =
  | { mode: "none" }
  | { mode: "bearer" }
  | { mode: "header"; header: string; scheme?: string }
  | { mode: "query"; param: string }
  | { mode: "basic" }
  | {
      mode: "session";
      login_path: string;
      login_method?: "GET" | "POST";
      login_format?: "form" | "json";
      login_fields?: Record<string, string>;
      cookie_name: string;
      ok_body_contains?: string;
      renew_on?: number[];
    };

export type AppRecipe = {
  /** CasaOS app ids (normalised) this recipe matches. */
  ids: string[];
  /** Additional name keywords, for apps whose CasaOS id differs from the product. */
  keywords?: string[];
  name: string;
  description: string;
  mode: "http" | "mcp" | "unsupported";
  http?: {
    auth: RecipeAuth;
    healthcheck: { method?: "GET" | "POST"; path: string; ok_status?: number[] };
    operations: RecipeOperation[];
    credential: {
      label: string;
      hint: string;
      /** "api_key" | "user_password" | "token" */
      format?: "api_key" | "user_password" | "token";
      /** Where to create the credential, relative to the app base URL. */
      where?: string;
    };
    capabilities?: string[];
    resources?: string[];
  };
  mcp?: {
    /** Paths to try, in order, on the app base URL. */
    paths: string[];
    /**
     * Port the MCP server listens on when it is not the app's web port.
     * Obsidian's Local REST API uses 27124 while the web UI is on another port.
     */
    port?: number;
    scheme?: "http" | "https";
    /** The app serves a self-signed certificate whose SAN may not match. */
    allow_insecure_tls?: boolean;
    credential: { label: string; hint: string; where?: string };
    headers?: Array<{ header: string; scheme?: string }>;
    capabilities?: string[];
    resources?: string[];
    /**
     * Upstream tool classification. Without it every tool is treated as a
     * read, which would silently turn vault writes into no-approval actions.
     */
    tools?: { read?: string[]; write?: string[]; deny?: string[] };
  };
  /** Honest limitation for apps Jarvis cannot drive yet. */
  notes?: string;
  docs?: string;
};

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const JELLYFIN: AppRecipe = {
  ids: ["jellyfin"],
  keywords: ["jellyfin"],
  name: "Jellyfin",
  description: "媒体库搜索、最近添加、播放会话与设备状态。",
  mode: "http",
  http: {
    auth: { mode: "header", header: "X-Emby-Token", scheme: "" },
    healthcheck: { path: "/Users", ok_status: [200] },
    credential: {
      label: "Jellyfin API Key",
      hint: "Jellyfin 控制台 → API 密钥 → 新建密钥，复制生成的密钥。",
      format: "api_key",
      where: "/web/index.html#!/settings/apikeys",
    },
    capabilities: ["media.read", "media.*"],
    resources: ["item"],
    operations: [
      {
        name: "system_info",
        description: "读取服务器名称、版本和运行环境。",
        method: "GET",
        path: "/System/Info",
        read_only: true,
      },
      {
        name: "items_search",
        description: "按关键词搜索电影、剧集、单集或音乐。",
        method: "GET",
        path: "/Items",
        read_only: true,
        params: [
          { name: "searchTerm", in: "query", required: true, description: "搜索关键词" },
          { name: "includeItemTypes", in: "query", description: "Movie,Series,Episode,Audio 等，逗号分隔" },
          { name: "recursive", in: "query", type: "boolean", description: "是否递归搜索整库" },
          { name: "limit", in: "query", type: "number", description: "返回数量上限" },
          { name: "fields", in: "query", description: "额外字段，逗号分隔" },
          { name: "sortBy", in: "query", description: "排序字段" },
        ],
      },
      {
        name: "items_latest",
        description: "读取媒体库最近添加的内容。",
        method: "GET",
        path: "/Items/Latest",
        read_only: true,
        params: [
          { name: "limit", in: "query", type: "number" },
          { name: "includeItemTypes", in: "query" },
        ],
      },
      {
        name: "item_get",
        description: "按 ID 读取一个媒体条目的详情。",
        method: "GET",
        path: "/Items/{itemId}",
        read_only: true,
        params: [{ name: "itemId", in: "path", required: true }],
      },
      {
        name: "sessions_list",
        description: "读取当前播放会话和在线客户端。",
        method: "GET",
        path: "/Sessions",
        read_only: true,
      },
      {
        name: "devices_list",
        description: "读取已登记的设备。",
        method: "GET",
        path: "/Devices",
        read_only: true,
      },
      {
        name: "activity_log",
        description: "读取最近的活动日志。",
        method: "GET",
        path: "/System/ActivityLog/Entries",
        read_only: true,
        params: [{ name: "limit", in: "query", type: "number" }],
      },
      {
        name: "library_refresh",
        description: "触发媒体库扫描（写操作，可能耗时）。",
        method: "POST",
        path: "/Library/Refresh",
        read_only: false,
      },
      {
        name: "session_message",
        description: "向指定播放会话发送一条提示消息。",
        method: "POST",
        path: "/Sessions/{sessionId}/Message",
        read_only: false,
        params: [
          { name: "sessionId", in: "path", required: true },
          { name: "text", in: "query", required: true },
          { name: "header", in: "query" },
        ],
      },
      {
        name: "plugins_installed",
        description: "读取 Jellyfin 已安装的插件及状态（Active、Restart、Disabled 等）。",
        method: "GET",
        path: "/Plugins",
        read_only: true,
      },
      {
        name: "plugin_package",
        description: "按名称查询官方插件仓库中的包信息（GUID、可用版本）。安装前先用它确认包名。",
        method: "GET",
        path: "/Packages/{name}",
        read_only: true,
        params: [
          { name: "name", in: "path", required: true, description: "插件包名，例如 Open Subtitles" },
        ],
      },
      {
        name: "plugin_install",
        description: "从 Jellyfin 插件仓库安装插件（写操作）。不填版本则安装最新版；安装后通常需要 system_restart 才会生效。",
        method: "POST",
        path: "/Packages/Installed/{name}",
        read_only: false,
        params: [
          { name: "name", in: "path", required: true, description: "插件包名，例如 Open Subtitles" },
          { name: "version", in: "query", description: "可选版本号；不填则安装最新版" },
          { name: "repositoryUrl", in: "query", description: "可选插件仓库地址" },
        ],
      },
      {
        name: "plugin_uninstall",
        description: "卸载指定版本的插件（写操作）。",
        method: "DELETE",
        path: "/Plugins/{pluginId}/{version}",
        read_only: false,
        params: [
          { name: "pluginId", in: "path", required: true, description: "插件 GUID" },
          { name: "version", in: "path", required: true },
        ],
      },
      {
        name: "plugin_enable",
        description: "启用已禁用的插件（写操作）。",
        method: "POST",
        path: "/Plugins/{pluginId}/{version}/Enable",
        read_only: false,
        params: [
          { name: "pluginId", in: "path", required: true },
          { name: "version", in: "path", required: true },
        ],
      },
      {
        name: "plugin_disable",
        description: "禁用插件（写操作）。",
        method: "POST",
        path: "/Plugins/{pluginId}/{version}/Disable",
        read_only: false,
        params: [
          { name: "pluginId", in: "path", required: true },
          { name: "version", in: "path", required: true },
        ],
      },
      {
        name: "system_restart",
        description: "重启 Jellyfin 服务（写操作，会短暂中断播放）。安装或更新插件后使用。",
        method: "POST",
        path: "/System/Restart",
        read_only: false,
      },
    ],
  },
  docs: "https://api.jellyfin.org/",
};

const QBITTORRENT: AppRecipe = {
  ids: ["qbittorrent"],
  keywords: ["qbittorrent", "qbit"],
  name: "qBittorrent",
  description: "种子列表、传输状态与受控的添加/暂停/删除操作。",
  mode: "http",
  http: {
    auth: {
      mode: "session",
      login_path: "/api/v2/auth/login",
      login_format: "form",
      login_fields: { username: "{username}", password: "{password}" },
      cookie_name: "SID",
      ok_body_contains: "Ok.",
    },
    healthcheck: { path: "/api/v2/app/version", ok_status: [200] },
    credential: {
      label: "qBittorrent 用户名:密码",
      hint: "填写 qBittorrent 的登录用户名和密码，用英文冒号连接，例如 admin:你的密码。Jarvis 会用它们建立会话，不会保存明文密码到日志。",
      format: "user_password",
      where: "/",
    },
    capabilities: ["download.read", "download.*"],
    resources: ["torrent"],
    operations: [
      {
        name: "app_version",
        description: "读取 qBittorrent 版本。",
        method: "GET",
        path: "/api/v2/app/version",
        read_only: true,
      },
      {
        name: "transfer_info",
        description: "读取全局上传/下载速度和连接状态。",
        method: "GET",
        path: "/api/v2/transfer/info",
        read_only: true,
      },
      {
        name: "torrents_list",
        description: "读取种子列表，可按状态、分类或排序过滤。",
        method: "GET",
        path: "/api/v2/torrents/info",
        read_only: true,
        params: [
          { name: "filter", in: "query", description: "all, downloading, seeding, paused, completed 等" },
          { name: "category", in: "query" },
          { name: "sort", in: "query" },
          { name: "limit", in: "query", type: "number" },
        ],
      },
      {
        name: "torrents_properties",
        description: "读取单个种子的详细信息。",
        method: "GET",
        path: "/api/v2/torrents/properties",
        read_only: true,
        params: [{ name: "hash", in: "query", required: true }],
      },
      {
        name: "torrents_trackers",
        description: "读取单个种子的 tracker 状态。",
        method: "GET",
        path: "/api/v2/torrents/trackers",
        read_only: true,
        params: [{ name: "hash", in: "query", required: true }],
      },
      {
        name: "torrents_files",
        description: "读取种子内的文件列表。",
        method: "GET",
        path: "/api/v2/torrents/files",
        read_only: true,
        params: [{ name: "hash", in: "query", required: true }],
      },
      {
        name: "app_preferences",
        description: "读取应用偏好设置。",
        method: "GET",
        path: "/api/v2/app/preferences",
        read_only: true,
      },
      {
        name: "torrents_add",
        description: "通过磁力链接或 URL 添加种子。",
        method: "POST",
        path: "/api/v2/torrents/add",
        read_only: false,
        body_format: "form",
        params: [
          { name: "urls", in: "body", required: true, description: "磁力链接或 .torrent URL" },
          { name: "savepath", in: "body" },
          { name: "category", in: "body" },
          { name: "paused", in: "body", type: "boolean" },
        ],
      },
      {
        name: "torrents_pause",
        description: "暂停指定种子。",
        method: "POST",
        path: "/api/v2/torrents/pause",
        read_only: false,
        body_format: "form",
        params: [{ name: "hashes", in: "body", required: true, description: "种子 hash，多个用 | 分隔；all 表示全部" }],
      },
      {
        name: "torrents_resume",
        description: "恢复指定种子。",
        method: "POST",
        path: "/api/v2/torrents/resume",
        read_only: false,
        body_format: "form",
        params: [{ name: "hashes", in: "body", required: true }],
      },
      {
        name: "torrents_delete",
        description: "删除指定种子，可选同时删除文件。",
        method: "POST",
        path: "/api/v2/torrents/delete",
        read_only: false,
        body_format: "form",
        params: [
          { name: "hashes", in: "body", required: true },
          { name: "deleteFiles", in: "body", type: "boolean" },
        ],
      },
    ],
  },
  docs: "https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)",
};

const IMMICH: AppRecipe = {
  ids: ["immich"],
  keywords: ["immich"],
  name: "Immich",
  description: "照片与相册搜索、资源详情。Immich 已内置专用的 MCP 连接时优先使用它。",
  mode: "http",
  http: {
    auth: { mode: "header", header: "x-api-key", scheme: "" },
    healthcheck: { path: "/api/users/me", ok_status: [200] },
    credential: {
      label: "Immich API Key",
      hint: "Immich 账户设置 → API 密钥 → 新建密钥。",
      format: "api_key",
      where: "/user-settings",
    },
    capabilities: ["photo.read", "photo.*"],
    resources: ["photo", "album"],
    operations: [
      { name: "server_ping", description: "检查服务是否在线。", method: "GET", path: "/api/server/ping", read_only: true },
      { name: "server_about", description: "读取服务版本与功能。", method: "GET", path: "/api/server/about", read_only: true },
      { name: "users_me", description: "读取当前 API Key 对应的账户。", method: "GET", path: "/api/users/me", read_only: true },
      { name: "albums_list", description: "列出相册。", method: "GET", path: "/api/albums", read_only: true },
      {
        name: "assets_random",
        description: "随机读取若干照片资源。",
        method: "GET",
        path: "/api/assets/random",
        read_only: true,
        params: [{ name: "count", in: "query", type: "number" }],
      },
      {
        name: "asset_get",
        description: "按 ID 读取一个照片资源。",
        method: "GET",
        path: "/api/assets/{id}",
        read_only: true,
        params: [{ name: "id", in: "path", required: true }],
      },
      {
        name: "search_metadata",
        description: "按条件搜索照片（JSON 请求体）。",
        method: "POST",
        path: "/api/search/metadata",
        read_only: true,
        params: [
          { name: "query", in: "body", description: "语义搜索关键词" },
          { name: "page", in: "body", type: "number" },
          { name: "size", in: "body", type: "number" },
        ],
      },
    ],
  },
  docs: "https://immich.app/docs/api/introduction",
};

const HOME_ASSISTANT: AppRecipe = {
  ids: ["homeassistant", "home-assistant"],
  keywords: ["homeassistant"],
  name: "Home Assistant",
  description: "家庭设备状态、实体列表与摄像头快照（MCP）。",
  mode: "mcp",
  mcp: {
    paths: ["/api/mcp"],
    credential: {
      label: "Home Assistant 长期访问令牌",
      hint: "Home Assistant 个人资料 → 安全 → 长期访问令牌 → 创建令牌。",
      where: "/profile/security",
    },
    headers: [{ header: "Authorization", scheme: "Bearer" }],
    capabilities: ["home.read", "home.*"],
    resources: ["entity"],
  },
  docs: "https://developers.home-assistant.io/docs/api/rest/",
};

const PORTAINER: AppRecipe = {
  ids: ["portainer"],
  keywords: ["portainer"],
  name: "Portainer",
  description: "容器、堆栈与端点状态。",
  mode: "http",
  http: {
    auth: { mode: "header", header: "X-API-Key", scheme: "" },
    healthcheck: { path: "/api/users/me", ok_status: [200] },
    credential: {
      label: "Portainer API Key",
      hint: "Portainer 账户设置 → 访问令牌 → 添加访问令牌。",
      format: "api_key",
      where: "/#!/account",
    },
    capabilities: ["container.read", "container.*"],
    resources: ["container", "stack"],
    operations: [
      { name: "system_status", description: "读取 Portainer 系统状态。", method: "GET", path: "/api/system/status", read_only: true },
      { name: "endpoints_list", description: "列出环境端点。", method: "GET", path: "/api/endpoints", read_only: true },
      { name: "stacks_list", description: "列出堆栈。", method: "GET", path: "/api/stacks", read_only: true },
      {
        name: "containers_list",
        description: "列出端点上的容器。",
        method: "GET",
        path: "/api/endpoints/{endpointId}/docker/containers/json",
        read_only: true,
        params: [
          { name: "endpointId", in: "path", required: true, type: "number" },
          { name: "all", in: "query", type: "boolean" },
        ],
      },
    ],
  },
  docs: "https://docs.portainer.io/api/access",
};

const GRAFANA: AppRecipe = {
  ids: ["grafana"],
  keywords: ["grafana"],
  name: "Grafana",
  description: "仪表盘搜索、数据源与告警读取。",
  mode: "http",
  http: {
    auth: { mode: "header", header: "Authorization", scheme: "Bearer" },
    healthcheck: { path: "/api/user", ok_status: [200] },
    credential: {
      label: "Grafana Service Account Token",
      hint: "Grafana 管理 → 服务账户 → 新建令牌（Viewer 角色足够）。",
      format: "token",
      where: "/org/serviceaccounts",
    },
    capabilities: ["dashboard.read", "dashboard.*"],
    resources: ["dashboard"],
    operations: [
      { name: "health", description: "读取 Grafana 健康状态。", method: "GET", path: "/api/health", read_only: true },
      {
        name: "dashboards_search",
        description: "搜索仪表盘。",
        method: "GET",
        path: "/api/search",
        read_only: true,
        params: [
          { name: "query", in: "query" },
          { name: "type", in: "query", description: "dash-folder 或 dash-db" },
          { name: "limit", in: "query", type: "number" },
        ],
      },
      { name: "datasources_list", description: "列出数据源。", method: "GET", path: "/api/datasources", read_only: true },
      {
        name: "alerts_list",
        description: "列出 Grafana 告警。",
        method: "GET",
        path: "/api/alertmanager/grafana/api/v2/alerts",
        read_only: true,
      },
    ],
  },
  docs: "https://grafana.com/docs/grafana/latest/developers/http_api/",
};

const GITEA: AppRecipe = {
  ids: ["gitea"],
  keywords: ["gitea"],
  name: "Gitea",
  description: "仓库、Issue 与账户信息。",
  mode: "http",
  http: {
    auth: { mode: "header", header: "Authorization", scheme: "token" },
    healthcheck: { path: "/api/v1/user", ok_status: [200] },
    credential: {
      label: "Gitea 访问令牌",
      hint: "Gitea 设置 → 应用 → 生成令牌（只读权限即可）。",
      format: "token",
      where: "/user/settings/applications",
    },
    capabilities: ["repository.read", "repository.*"],
    resources: ["repository", "issue"],
    operations: [
      { name: "user_get", description: "读取令牌对应的账户。", method: "GET", path: "/api/v1/user", read_only: true },
      {
        name: "repos_search",
        description: "搜索仓库。",
        method: "GET",
        path: "/api/v1/repos/search",
        read_only: true,
        params: [
          { name: "q", in: "query" },
          { name: "limit", in: "query", type: "number" },
        ],
      },
      {
        name: "repo_get",
        description: "读取一个仓库。",
        method: "GET",
        path: "/api/v1/repos/{owner}/{repo}",
        read_only: true,
        params: [
          { name: "owner", in: "path", required: true },
          { name: "repo", in: "path", required: true },
        ],
      },
      {
        name: "issues_list",
        description: "读取仓库 Issue。",
        method: "GET",
        path: "/api/v1/repos/{owner}/{repo}/issues",
        read_only: true,
        params: [
          { name: "owner", in: "path", required: true },
          { name: "repo", in: "path", required: true },
          { name: "state", in: "query", description: "open, closed, all" },
        ],
      },
    ],
  },
  docs: "https://docs.gitea.com/api/1.22/",
};

const MOSQUITTO: AppRecipe = {
  ids: ["mosquitto", "eclipse-mosquitto"],
  keywords: ["mosquitto", "mqtt"],
  name: "Mosquitto",
  description: "MQTT 消息代理。",
  mode: "unsupported",
  notes: "Mosquitto 是 MQTT broker，没有 HTTP API。Jarvis 目前只支持 HTTP 与 MCP 连接，暂时不能直接读取它的消息或客户端状态。",
};

const IMMICHFRAME: AppRecipe = {
  ids: ["immichframe"],
  keywords: ["immichframe"],
  name: "ImmichFrame",
  description: "Immich 相框展示客户端。",
  mode: "unsupported",
  notes: "ImmichFrame 是展示客户端而不是带 API 的应用。请直接连接 Immich，Jarvis 会通过 Immich 读取照片。",
};

const OBSIDIAN: AppRecipe = {
  ids: ["obsidian"],
  keywords: ["obsidian"],
  name: "Obsidian",
  description: "笔记库：长期记忆、思维宫殿、检索与受控写入。",
  mode: "mcp",
  mcp: {
    // The Local REST API plugin (with MCP) serves `/mcp/` on its own port.
    paths: ["/mcp/"],
    port: 27124,
    scheme: "https",
    // The plugin generates a self-signed certificate valid for 127.0.0.1 only,
    // so verification must be relaxed for this one upstream.
    allow_insecure_tls: true,
    credential: {
      label: "Obsidian Local REST API Key",
      hint: "Obsidian → 设置 → Local REST API with MCP → 复制 API Key。请先在该页启用 Secure Server（端口 27124）。",
      where: "/",
    },
    headers: [{ header: "Authorization", scheme: "Bearer" }],
    capabilities: ["memory.read", "memory.*"],
    resources: ["note"],
    tools: {
      read: [
        "vault_list",
        "vault_read",
        "vault_get_document_map",
        "active_file_get_path",
        "search_query",
        "search_simple",
        "tag_list",
        "command_list",
      ],
      write: [
        "vault_write",
        "vault_append",
        "vault_patch",
        "vault_move",
        "vault_copy",
        "command_execute",
        "open_file",
      ],
      // Memory must never be destroyed through chat. Deleting stays a manual
      // Obsidian action unless the manifest is edited deliberately.
      deny: ["vault_delete"],
    },
  },
  docs: "https://coddingtonbear.github.io/obsidian-local-rest-api/",
};

const JARVIS_SELF: AppRecipe = {
  ids: ["jarvis"],
  keywords: ["jarvis"],
  name: "Jarvis",
  description: "Jarvis 自身。",
  mode: "unsupported",
  notes: "这是 Jarvis 自身，不需要也不应该再连接一次。",
};

export const appRecipes: readonly AppRecipe[] = [
  JELLYFIN,
  QBITTORRENT,
  IMMICH,
  HOME_ASSISTANT,
  OBSIDIAN,
  PORTAINER,
  GRAFANA,
  GITEA,
  MOSQUITTO,
  IMMICHFRAME,
  JARVIS_SELF,
];

/** Find the recipe for a CasaOS app id or display name. */
export function recipeFor(id: string, name = ""): AppRecipe | undefined {
  const candidates = new Set([normalise(id), normalise(name)]);
  return appRecipes.find((recipe) =>
    [...recipe.ids, ...(recipe.keywords ?? [])].some((key) => candidates.has(normalise(key))),
  );
}

/**
 * Whether a recipe knows an app well enough to configure it automatically.
 * "unsupported" and unknown apps both need a human decision.
 */
export function recipeIsAutomatic(recipe: AppRecipe | undefined): recipe is AppRecipe & { mode: "http" } {
  return Boolean(recipe && recipe.mode === "http" && recipe.http && recipe.http.operations.length);
}

/** Fill the schema defaults so the recipe data can stay terse. */
function recipeAuth(auth: RecipeAuth): HttpAuth {
  if (auth.mode === "header") return { mode: "header", header: auth.header, scheme: auth.scheme ?? "" };
  if (auth.mode === "session") {
    return {
      mode: "session",
      login_path: auth.login_path,
      login_method: auth.login_method ?? "POST",
      login_format: auth.login_format ?? "form",
      login_fields: auth.login_fields ?? { username: "{username}", password: "{password}" },
      cookie_name: auth.cookie_name,
      ...(auth.ok_body_contains ? { ok_body_contains: auth.ok_body_contains } : {}),
      renew_on: auth.renew_on ?? [401, 403],
    };
  }
  return auth;
}

/**
 * Resolve the MCP endpoint for a recipe.
 *
 * Most apps serve MCP on their web origin. A few (Obsidian) expose it on a
 * separate port, so the host is reused and only the port changes. Keeping this
 * in one place means the catalog, the manifest builder and the setup guide all
 * agree.
 */
export function recipeMcpEndpoint(recipe: AppRecipe, baseUrl: string): string | undefined {
  if (!recipe.mcp) return undefined;
  const path = recipe.mcp.paths[0] ?? "/mcp";
  const suffix = `${path.startsWith("/") ? "" : "/"}${path}`;
  if (!recipe.mcp.port) return `${baseUrl.replace(/\/$/, "")}${suffix}`;
  try {
    const base = new URL(baseUrl);
    const scheme = recipe.mcp.scheme ?? base.protocol.replace(":", "");
    return `${scheme}://${base.hostname}:${recipe.mcp.port}${suffix}`;
  } catch {
    return undefined;
  }
}

/** Build the strict manifest the registry will validate and store. */
export function buildRecipeManifest(
  recipe: AppRecipe,
  app: { id: string; name: string; description?: string; baseUrl: string },
): Record<string, unknown> {
  const base = app.baseUrl.replace(/\/$/, "");
  // A recipe's short description is more useful than the CasaOS store copy;
  // fall back to the installed app's description only when the recipe has none.
  const description = (recipe.description || app.description?.trim() || "").slice(0, 400);
  const appMeta = {
    base_url: base,
    deep_links: {},
    capabilities: recipe.http?.capabilities ?? recipe.mcp?.capabilities ?? [],
    resources: recipe.http?.resources ?? recipe.mcp?.resources ?? [],
  };
  if (recipe.mode === "http" && recipe.http) {
    const operations = recipe.http.operations.map((operation) => ({
      ...operation,
      description: operation.description ?? "",
      params: (operation.params ?? []).map((param) => ({
        name: param.name,
        in: param.in ?? "query",
        required: param.required ?? false,
        type: param.type ?? "string",
        description: param.description ?? "",
      })),
    }));
    const auth: HttpAuth = recipeAuth(recipe.http.auth);
    return {
      id: app.id,
      name: app.name.slice(0, 80),
      description,
      kind: "http",
      transport: {
        type: "http",
        base_url: base,
        auth,
        operations,
        max_response_bytes: 256 * 1024,
        timeout_ms: 15000,
      },
      credential: { store_provider: app.id, hint: recipe.http.credential.hint },
      tools: {
        read: operations.filter((operation) => operation.read_only).map((operation) => operation.name),
        write: operations.filter((operation) => !operation.read_only).map((operation) => operation.name),
        deny: [],
        overrides: {},
      },
      scopes: {},
      capabilities: recipe.http.capabilities ?? [],
      app: appMeta,
      healthcheck: {
        method: recipe.http.healthcheck.method ?? "GET",
        path: recipe.http.healthcheck.path,
        header: auth.mode === "header" ? auth.header : "Authorization",
        scheme: auth.mode === "header" ? auth.scheme : "",
        ok_status: recipe.http.healthcheck.ok_status ?? [200],
      },
      risk: "read",
      enabled: true,
    };
  }
  if (recipe.mode === "mcp" && recipe.mcp) {
    const endpoint = recipeMcpEndpoint(recipe, base);
    if (!endpoint) throw Error("app_recipe_not_connectable");
    return {
      id: app.id,
      name: app.name.slice(0, 80),
      description,
      kind: "mcp",
      transport: {
        type: "streamable-http",
        endpoint,
        credential_header: recipe.mcp.headers?.[0]?.header ?? "Authorization",
        credential_scheme: recipe.mcp.headers?.[0]?.scheme ?? "Bearer",
        endpoint_path: "",
        allow_insecure_tls: recipe.mcp.allow_insecure_tls ?? false,
      },
      credential: { store_provider: app.id, hint: recipe.mcp.credential.hint },
      tools: {
        read: recipe.mcp.tools?.read ?? ["*"],
        write: recipe.mcp.tools?.write ?? [],
        deny: recipe.mcp.tools?.deny ?? [],
        overrides: {},
      },
      scopes: {},
      capabilities: recipe.mcp.capabilities ?? [],
      app: appMeta,
      risk: "read",
      enabled: true,
    };
  }
  throw Error("app_recipe_not_connectable");
}

/** Credential metadata for the UI and the guide. */
export function recipeCredential(recipe: AppRecipe | undefined): {
  label: string;
  hint: string;
  format: "api_key" | "user_password" | "token";
  where?: string;
} | undefined {
  const credential = recipe?.http?.credential
    ? recipe.http.credential
    : recipe?.mcp?.credential
      ? { ...recipe.mcp.credential, format: "token" as const }
      : undefined;
  if (!credential) return undefined;
  return {
    label: credential.label,
    hint: credential.hint,
    format: credential.format ?? "api_key",
    ...(credential.where ? { where: credential.where } : {}),
  };
}
