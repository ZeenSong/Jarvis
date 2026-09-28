"""Policy-gated MCP entry point for one household upstream service.

Hermes sees Home Assistant and Immich as separate MCP servers. The actual
upstream server is opened only after Jarvis authorizes the current member.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

from mcp.server import MCPServer

from jarvis_provider import _mcp_call, _mcp_tools


PROVIDER = os.environ.get("MCP_PROVIDER", "").strip()
if PROVIDER not in {"homeassistant", "immich"}:
    raise RuntimeError("MCP_PROVIDER must be homeassistant or immich")


server = MCPServer(
    PROVIDER,
    instructions=(
        f"Jarvis policy-gated {PROVIDER} MCP. Every call requires the exact context_token "
        "from the Jarvis system message. Call mcp_tools_list first, then mcp_tool_call "
        "with the exact upstream tool name and arguments. Jarvis checks the current "
        "household member capability before forwarding."
    ),
)


@server.tool()
async def mcp_tools_list(context_token: str) -> str:
    """读取该上游 MCP 的完整工具清单和参数 schema。"""
    return await _mcp_tools(PROVIDER, context_token)


@server.tool()
async def mcp_tool_call(context_token: str, tool_name: str, arguments: dict[str, object] = {}) -> str:
    """调用该上游 MCP 的原始工具；工具名、参数和返回值由上游 MCP 定义。"""
    if not tool_name.strip() or len(tool_name) > 200:
        return json.dumps({"error": "mcp_tool_invalid"}, ensure_ascii=False)
    return await _mcp_call(PROVIDER, context_token, tool_name, arguments)


async def main() -> None:
    if not os.environ.get("JARVIS_BRIDGE_KEY"):
        print("JARVIS_BRIDGE_KEY is required", file=sys.stderr)
        raise SystemExit(2)
    await server.run_stdio_async()


if __name__ == "__main__":
    asyncio.run(main())
