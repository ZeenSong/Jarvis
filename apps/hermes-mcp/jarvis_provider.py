"""Jarvis capability provider for the Hermes Jarvis Agent.

Jarvis is a first-class Hermes Agent profile. This MCP server is only its
Jarvis-kernel capability bridge; it is not the Agent identity.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
from contextlib import asynccontextmanager
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from typing import Literal

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client
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


def _call_json(tool: str, context_token: str, **arguments: object) -> dict:
    value = json.loads(_call(tool, context_token, **arguments))
    if not isinstance(value, dict):
        raise RuntimeError("jarvis_bridge_invalid_response")
    if value.get("error"):
        raise RuntimeError(str(value["error"]))
    return value


def _dump(value: object) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json", by_alias=True, exclude_none=True)
    return json.dumps(value, ensure_ascii=False, default=str)


def _publish_media(context_token: str, data: bytes, content_type: str, source: str) -> str:
    body = json.dumps({
        "context_token": context_token,
        "content_type": content_type,
        "source": source,
        "data": base64.b64encode(data).decode("ascii"),
    }).encode("utf-8")
    request = Request(
        f"{BASE_URL}/internal/hermes/media",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Jarvis-Bridge-Key": BRIDGE_KEY,
        },
    )
    with urlopen(request, timeout=30) as response:
        value = json.load(response)
    if not isinstance(value, dict) or not isinstance(value.get("id"), str):
        raise RuntimeError("jarvis_media_publish_invalid_response")
    return value["id"]


async def _dump_tool_result(value: object, context_token: str, source: str) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json", by_alias=True, exclude_none=True)
    if isinstance(value, dict) and isinstance(value.get("content"), list):
        content = value["content"]
        for item in content:
            if not isinstance(item, dict):
                continue
            image_data = item.get("data") if item.get("type") == "image" else None
            image_type = item.get("mimeType") if item.get("type") == "image" else None
            resource = item.get("resource") if item.get("type") == "resource" else None
            if isinstance(resource, dict) and isinstance(resource.get("blob"), str):
                image_data = resource["blob"]
                image_type = resource.get("mimeType")
            if not isinstance(image_data, str) or not isinstance(image_type, str) or not image_type.startswith("image/"):
                continue
            try:
                raw = base64.b64decode(image_data, validate=True)
                if not raw or len(raw) > 2 * 1024 * 1024:
                    continue
                resource_id = await asyncio.to_thread(_publish_media, context_token, raw, image_type, source)
                item.clear()
                item.update({"type": "text", "text": f"MEDIA_RESOURCE:{resource_id}"})
            except Exception:
                continue
    return _dump(value)


async def _authorize(context_token: str, provider: str, tool_name: str, read_only: bool) -> dict:
    return await asyncio.to_thread(
        _call_json,
        "mcp_authorize",
        context_token,
        provider=provider,
        tool_name=tool_name,
        read_only=read_only,
    )


@asynccontextmanager
async def _upstream(provider: str, config: dict):
    """Open the real upstream MCP server with the household credential.

    This is a transport gateway, not a Home Assistant or Immich adapter. The
    upstream server owns the tool names, schemas and results; Jarvis only
    supplies the household credential after its member policy has approved the
    request.
    """
    if provider == "homeassistant":
        async with create_mcp_http_client(headers={"Authorization": f"Bearer {config['token']}"}) as client:
            async with streamable_http_client(config["endpoint"], http_client=client) as streams:
                async with ClientSession(*streams) as session:
                    await session.initialize()
                    yield session
        return
    if provider == "immich":
        env = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "LANG": os.environ.get("LANG", "C.UTF-8"),
            "DOTNET_ROOT": os.environ.get("DOTNET_ROOT", "/usr/share/dotnet"),
            "DOTNET_SYSTEM_GLOBALIZATION_INVARIANT": os.environ.get("DOTNET_SYSTEM_GLOBALIZATION_INVARIANT", "1"),
            "IMMICH_BASE_URL": str(config["base_url"]),
            "IMMICH_API_KEY": str(config["token"]),
        }
        params = StdioServerParameters(
            command=os.environ.get("IMMICH_MCP_COMMAND", "/usr/share/dotnet/dotnet"),
            args=[os.environ.get("IMMICH_MCP_DLL", "/opt/immich-mcp/ImmichMCP.dll"), "--stdio"],
            env=env,
        )
        async with stdio_client(params) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()
                yield session
        return
    raise RuntimeError("mcp_provider_invalid")


async def _mcp_tools(provider: str, context_token: str) -> str:
    config = await _authorize(context_token, provider, "__tools_list__", True)
    async with _upstream(provider, config) as session:
        return _dump(await session.list_tools())


async def _mcp_call(provider: str, context_token: str, tool_name: str, arguments: dict[str, object]) -> str:
    # The schema and annotations come from the upstream server. We do not trust
    # a model-supplied read_only flag to authorize a write operation.
    read_config = await _authorize(context_token, provider, "__tools_list__", True)
    async with _upstream(provider, read_config) as session:
        tools = await session.list_tools()
        selected = next((tool for tool in tools.tools if tool.name == tool_name), None)
        if selected is None:
            raise RuntimeError("mcp_tool_not_found")
        annotations = getattr(selected, "annotations", None)
        read_only = bool(getattr(annotations, "read_only_hint", False)) if annotations is not None else False
        if read_only:
            return await _dump_tool_result(await session.call_tool(tool_name, arguments), context_token, provider)

    # A write tool requires a separate explicit write permission. Re-open the
    # upstream only after Jarvis approves it, so a member can never bypass the
    # policy by claiming that a tool is read-only.
    write_config = await _authorize(context_token, provider, tool_name, False)
    async with _upstream(provider, write_config) as session:
        return await _dump_tool_result(await session.call_tool(tool_name, arguments), context_token, provider)


server = MCPServer(
    "jarvis",
    instructions=(
        "Jarvis kernel capability provider for the first-class Jarvis Agent. "
        "Hermes owns reasoning and the tool loop; use these tools for current Jarvis state, metrics, user runs, "
        "usage, dashboard views, household service summaries, and scheduling. Every tool call requires the exact context_token "
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
    """读取当前用户的模型用量，包括按真实 Conversation 汇总的 top_conversations 会话排行。回答“哪个会话最高”时使用该排行，不要从其他指标推测。"""
    return _call("llm_usage_read", context_token)


@server.tool()
def agent_run_status(context_token: str, run_id: str) -> str:
    """读取当前用户指定任务的状态。"""
    return _call("agent_run_status", context_token, run_id=run_id)


@server.tool()
def ui_view_show(context_token: str, intent: str, resources: list[str] = [], target: Literal["inline", "workspace"] = "workspace", view: dict | None = None) -> str:
    """交付 UI Protocol V2 结果。usage_analysis 使用已有用量资源，首屏突出 llm_usage_read 返回的最高消耗 Conversation、Token 数与今日占比，并提供真实 Top 会话排行；cat_activity 用真实 Frigate 与 Home Assistant 数据构造 view 并进入工作区；cat_photos 用 photo_grid 构造 view，始终内联展示。view 必须包含 ui_protocol='2.0', id, revision, intent='overview'或'search', title, layout={type:'workspace'}, sections 与 fallback。section 包含 id,role,component,component_version=2,title,data,actions=[],fallback。不要编造数据、传感器或工具。照片项引用工具结果中的 MEDIA_RESOURCE UUID，放入 resource_id，不要拼接文件系统路径。相同 intent 更新原工作区。"""
    args = dict(intent=intent, resources=resources, target=target)
    if view is not None:
        args["view"] = view
    return _call("ui_view_show", context_token, **args)


@server.tool()
def task_create(context_token: str, goal: str, idempotency_key: str) -> str:
    """创建可追踪的只读 Ops 持久任务。每个新请求用唯一 idempotency_key；网络重试复用同一 key。返回 task_id/run_id。"""
    return _call("task_create", context_token, goal=goal, idempotency_key=idempotency_key)


@server.tool()
def task_cancel(context_token: str, run_id: str) -> str:
    """仅在用户要求停止任务时取消当前用户的指定任务。"""
    return _call("task_cancel", context_token, run_id=run_id)


@server.tool()
def schedule_create(context_token: str, prompt: str, cadence: Literal["once", "daily", "weekly"], next_run_at: str | None = None) -> str:
    """按用户指令创建定时任务。必须先确认执行时间和时区，next_run_at 为未来 ISO 8601 时间（含时区）；用户只说早上等模糊时间时先调用 conversation_question_create，禁止自行设为立即执行。"""
    arguments: dict[str, object] = {"prompt": prompt, "cadence": cadence}
    if next_run_at is not None:
        arguments["next_run_at"] = next_run_at
    return _call("schedule_create", context_token, **arguments)


@server.tool()
def conversation_question_create(context_token: str, kind: Literal["boolean", "single_choice"], prompt: str, options: list[dict[str, str]] = []) -> str:
    """当 Jarvis 需要用户确认或选择时，在当前 Conversation 创建结构化问题。"""
    return _call("conversation_question_create", context_token, kind=kind, prompt=prompt, options=options)


async def main() -> None:
    if not BRIDGE_KEY:
        print("JARVIS_BRIDGE_KEY is required", file=sys.stderr)
        raise SystemExit(2)
    await server.run_stdio_async()


if __name__ == "__main__":
    asyncio.run(main())
