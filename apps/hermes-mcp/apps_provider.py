"""Jarvis app catalog provider.

One static Hermes MCP server covers every application Jarvis can drive. Adding a
CasaOS app therefore edits data, not this file: the provider asks Jarvis for the
catalog, returns app-specific setup steps, and forwards tool calls through the
same policy gate as the built-in MCP providers.

No credential ever reaches this process for `app_*` calls. Jarvis resolves the
household secret and attaches it server-side, so a configured app is callable
immediately after `app_configure` without re-registering an MCP server.
"""

from __future__ import annotations

import json
import os
import sys

from mcp.server import MCPServer

from jarvis_provider import _call


server = MCPServer(
    "apps",
    instructions=(
        "CasaOS app catalog for Jarvis. Always pass the exact context_token from the Jarvis system message. "
        "Use app_list to see what is really installed. For an app that is not connected yet, call "
        "app_setup_guide, then app_configure with the guided arguments. Ask the user to enter credentials in "
        "the Jarvis UI, never in chat. Verify with app_test, inspect callable operations with app_tools_list, "
        "and execute them with app_tool_call(provider, tool_name, arguments). CasaOS itself is managed with "
        "casaos_app_detail / casaos_app_add_ports / casaos_app_restart / casaos_app_logs; those use Jarvis's "
        "saved CasaOS session. Never log in to CasaOS or any household service through a browser, the Hermes "
        "vault or a shell. Never invent an app, port, operation or tool name."
    ),
)


@server.tool()
def app_list(context_token: str) -> str:
    """列出 CasaOS 中已安装的应用，以及每个应用是否已经连接 Jarvis（不包含任何凭据）。"""
    return _call("app_list", context_token)


@server.tool()
def app_setup_guide(context_token: str, app_id: str) -> str:
    """读取某个应用的连接指南：检测到的地址/端口、认证方式、凭据创建页面、可调用操作和下一步应调用的工具。"""
    return _call("app_setup_guide", context_token, app_id=app_id)


@server.tool()
def app_configure(
    context_token: str,
    app_id: str,
    mode: str = "auto",
    base_url: str | None = None,
    endpoint: str | None = None,
    auth_mode: str = "auto",
    credential_header: str | None = None,
    credential_scheme: str | None = None,
    query_param: str | None = None,
    login_path: str | None = None,
    cookie_name: str | None = None,
    login_format: str | None = None,
    operations: list[dict[str, object]] | None = None,
    notes: str | None = None,
) -> str:
    """写入某个应用的连接配置（管理员）。优先只传 app_id 和 mode=auto，让 Jarvis 使用检测到的地址和内置配方；未知 HTTP 应用可显式传 base_url、auth_mode 与 operations（由用户提供的 API 文档得出）。此工具不接收密钥。"""
    arguments: dict[str, object] = {"app_id": app_id, "mode": mode, "auth_mode": auth_mode}
    for key, value in {
        "base_url": base_url,
        "endpoint": endpoint,
        "credential_header": credential_header,
        "credential_scheme": credential_scheme,
        "query_param": query_param,
        "login_path": login_path,
        "cookie_name": cookie_name,
        "login_format": login_format,
        "operations": operations,
        "notes": notes,
    }.items():
        if value is not None:
            arguments[key] = value
    return _call("app_configure", context_token, **arguments)


@server.tool()
def app_test(context_token: str, app_id: str) -> str:
    """验证某个应用当前的连接与凭据是否可用；会话型应用会真实登录一次。"""
    return _call("app_test", context_token, app_id=app_id)


@server.tool()
def app_remove(context_token: str, app_id: str) -> str:
    """移除某个应用的 Jarvis 连接配置（管理员）。不会卸载 CasaOS 应用。"""
    return _call("app_remove", context_token, app_id=app_id)


@server.tool()
def casaos_app_detail(context_token: str, app_id: str) -> str:
    """读取 CasaOS 应用的镜像与端口映射（不含环境变量、卷或凭据）。改端口前先用它确认服务名。"""
    return _call("casaos_app_detail", context_token, app_id=app_id)


@server.tool()
def casaos_app_add_ports(
    context_token: str,
    app_id: str,
    service: str,
    ports: list[dict[str, object]],
    dry_run: bool = False,
) -> str:
    """给 CasaOS 应用增加主机端口映射（管理员）。service 用 casaos_app_detail 返回的服务名；ports 形如 [{"target":27124,"published":27124,"protocol":"tcp"}]。真正应用前会先做一次 dry run 校验端口冲突；应用会重建容器。"""
    return _call(
        "casaos_app_add_ports",
        context_token,
        app_id=app_id,
        service=service,
        ports=ports,
        dry_run=dry_run,
    )


@server.tool()
def casaos_app_restart(context_token: str, app_id: str) -> str:
    """重启 CasaOS 应用（管理员）。"""
    return _call("casaos_app_restart", context_token, app_id=app_id)


@server.tool()
def casaos_app_logs(context_token: str, app_id: str, lines: int = 100) -> str:
    """读取 CasaOS 应用最近日志（管理员，最多 200 行）。"""
    return _call("casaos_app_logs", context_token, app_id=app_id, lines=lines)


@server.tool()
def app_tools_list(context_token: str, provider: str) -> str:
    """列出某个已连接应用当前可调用的操作：HTTP 应用返回声明的操作，MCP 应用返回上游真实工具。"""
    return _call("app_tools_list", context_token, provider=provider)


@server.tool()
def app_tool_call(
    context_token: str,
    provider: str,
    tool_name: str,
    arguments: dict[str, object] | None = None,
) -> str:
    """调用某个已连接应用的操作。provider 是应用 id，tool_name 必须来自 app_tools_list，arguments 按该操作的参数填写。"""
    return _call(
        "app_tool_call",
        context_token,
        provider=provider,
        tool_name=tool_name,
        arguments=arguments or {},
    )


async def main() -> None:
    if not os.environ.get("JARVIS_BRIDGE_KEY"):
        print("JARVIS_BRIDGE_KEY is required", file=sys.stderr)
        raise SystemExit(2)
    await server.run_stdio_async()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
