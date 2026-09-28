"""Policy-gated Frigate MCP entry point.

Frigate is an external household service, not a Jarvis-kernel capability.  It
is kept behind a separate MCP server so Hermes can distinguish camera tools
from Jarvis state and task tools while Jarvis still enforces member policy.
"""

from __future__ import annotations

import asyncio
import os
import sys

from mcp.server import MCPServer

from jarvis_provider import _call, _call_json


PROVIDER = "frigate"


server = MCPServer(
    PROVIDER,
    instructions=(
        "Jarvis policy-gated Frigate MCP. Every call requires the exact context_token "
        "from the Jarvis system message. Jarvis checks the current household member "
        "capability before reading camera events or snapshots."
    ),
)


async def _authorize(context_token: str, tool_name: str) -> None:
    await asyncio.to_thread(
        _call_json,
        "mcp_authorize",
        context_token,
        provider=PROVIDER,
        tool_name=tool_name,
        read_only=True,
    )


@server.tool()
async def frigate_events_read(context_token: str, after: float | None = None, before: float | None = None, limit: int = 40) -> str:
    """读取 Frigate 事件摘要。"""
    await _authorize(context_token, "frigate_events_read")
    arguments: dict[str, object] = {"limit": limit}
    if after is not None:
        arguments["after"] = after
    if before is not None:
        arguments["before"] = before
    return await asyncio.to_thread(_call, "frigate_events_read", context_token, **arguments)


@server.tool()
async def frigate_event_snapshot_read(context_token: str, event_id: str) -> str:
    """读取 Frigate 事件截图。"""
    await _authorize(context_token, "frigate_event_snapshot_read")
    return await asyncio.to_thread(_call, "frigate_event_snapshot_read", context_token, event_id=event_id)


async def main() -> None:
    if not os.environ.get("JARVIS_BRIDGE_KEY"):
        print("JARVIS_BRIDGE_KEY is required", file=sys.stderr)
        raise SystemExit(2)
    await server.run_stdio_async()


if __name__ == "__main__":
    asyncio.run(main())
