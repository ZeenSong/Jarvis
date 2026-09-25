"""Jarvis capability provider for the Hermes Jarvis Agent.

Jarvis is a first-class Hermes Agent profile. This MCP server is only its
Jarvis-kernel capability bridge; it is not the Agent identity.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from typing import Literal

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
    except HTTPError as exc:
        return exc.read(16000).decode("utf-8", errors="replace")
    except Exception as exc:
        return json.dumps({"error": str(exc)}, ensure_ascii=False)


server = MCPServer(
    "jarvis",
    instructions=(
        "Jarvis kernel capability provider for the first-class Jarvis Agent. "
        "Hermes owns reasoning and the "
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
def ui_view_show(context_token: str, intent: Literal["system_overview", "network_overview", "usage_analysis", "agent_run_analysis"], resources: list[str] = []) -> str:
    """展示持久化图表。服务器趋势用 system_overview 和 []；任务分析用 agent_run_analysis 和 ["agent-run/<run_id>"]。"""
    return _call("ui_view_show", context_token, intent=intent, resources=resources)


@server.tool()
def task_create(context_token: str, goal: str, idempotency_key: str) -> str:
    """创建可追踪的只读 Ops 持久任务。每个新请求用唯一 idempotency_key；网络重试复用同一 key。返回 task_id/run_id。"""
    return _call("task_create", context_token, goal=goal, idempotency_key=idempotency_key)


@server.tool()
def task_cancel(context_token: str, run_id: str) -> str:
    """仅在用户要求停止任务时取消当前用户的指定任务。"""
    return _call("task_cancel", context_token, run_id=run_id)


async def main() -> None:
    if not BRIDGE_KEY:
        print("JARVIS_BRIDGE_KEY is required", file=sys.stderr)
        raise SystemExit(2)
    await server.run_stdio_async()


if __name__ == "__main__":
    asyncio.run(main())
