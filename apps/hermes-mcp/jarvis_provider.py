"""Jarvis Capability provider for the official Hermes MCP client.

This process is intentionally small: Hermes owns the agent loop, while Jarvis
remains the authority for state, permissions, views, and durable runs.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from urllib.request import Request, urlopen

from mcp.server import MCPServer


BASE_URL = os.environ.get("JARVIS_INTERNAL_URL", "http://jarvis-server:8080").rstrip("/")
BRIDGE_KEY = os.environ.get("JARVIS_BRIDGE_KEY", "")


def _call(tool: str, context_token: str, **arguments: object) -> str:
    body = json.dumps({
        "tool": tool,
        "context_token": context_token,
        "arguments": arguments,
    }).encode("utf-8")
    request = Request(
        f"{BASE_URL}/internal/hermes/capability",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Jarvis-Bridge-Key": BRIDGE_KEY,
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.dumps(json.load(response), ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"error": str(exc)}, ensure_ascii=False)


server = MCPServer(
    "jarvis",
    instructions=(
        "Jarvis authoritative capability provider. Hermes owns reasoning and the "
        "tool loop; use these tools for current Jarvis state, metrics, user runs, "
        "usage, and dashboard views. Every tool call requires the exact context_token "
        "from the Jarvis system message. Never invent one."
    ),
)


@server.tool()
def system_status_read(context_token: str) -> str:
    """读取 Jarvis 服务器当前状态。"""
    return _call("system_status_read", context_token)


@server.tool()
def system_metrics_read(context_token: str) -> str:
    """读取 Jarvis 最近 24 小时实际采集的系统指标。"""
    return _call("system_metrics_read", context_token)


@server.tool()
def agent_list(context_token: str) -> str:
    """读取当前用户可见的 Agent、Task 和 Run。"""
    return _call("agent_list", context_token)


@server.tool()
def llm_usage_read(context_token: str) -> str:
    """读取当前用户的模型用量。"""
    return _call("llm_usage_read", context_token)


@server.tool()
def agent_run_status(context_token: str, run_id: str) -> str:
    """读取当前用户指定任务的状态。"""
    return _call("agent_run_status", context_token, run_id=run_id)


@server.tool()
def ui_view_show(context_token: str, intent: str, resources: list[str]) -> str:
    """展示一个由 Jarvis 预设定义的安全仪表盘视图。"""
    return _call("ui_view_show", context_token, intent=intent, resources=resources)


async def main() -> None:
    if not BRIDGE_KEY:
        print("JARVIS_BRIDGE_KEY is required", file=sys.stderr)
        raise SystemExit(2)
    await server.run_stdio_async()


if __name__ == "__main__":
    asyncio.run(main())
