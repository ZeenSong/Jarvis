#!/usr/bin/env python3
"""Fail an image build when a Jarvis MCP entry point registers another server's tools."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


PYTHON = "/opt/hermes/.venv/bin/python"
ROOT = "/opt/jarvis-source"


def verify_immich_preview_fetch() -> None:
    received: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            received["path"] = self.path
            received["key"] = self.headers.get("x-api-key", "")
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.end_headers()
            self.wfile.write(b"\xff\xd8\xff\xd9")

        def log_message(self, _format: str, *_args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        spec = importlib.util.spec_from_file_location("jarvis_provider_verify", f"{ROOT}/jarvis_provider.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("jarvis_provider_import_failed")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        asset_id = "10000000-0000-4000-8000-000000000001"
        data, content_type = module._immich_preview(
            {"base_url": f"http://127.0.0.1:{server.server_port}", "token": "private-test-key"},
            asset_id,
        )
        if data != b"\xff\xd8\xff\xd9" or content_type != "image/jpeg":
            raise RuntimeError("immich_preview_response_mismatch")
        if received != {"path": f"/api/assets/{asset_id}/thumbnail?size=preview", "key": "private-test-key"}:
            raise RuntimeError(f"immich_preview_request_mismatch:{received}")
    finally:
        server.shutdown()
        server.server_close()


async def verify_homeassistant_camera_bridge() -> None:
    received: list[tuple[str, str]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            received.append((self.path, self.headers.get("Authorization", "")))
            if self.path == "/api/states":
                body = json.dumps([
                    {"entity_id": "camera.dynamic", "state": "streaming", "attributes": {"friendly_name": "Current camera"}},
                    {"entity_id": "light.not_a_camera", "state": "on", "attributes": {"friendly_name": "Ignore me"}},
                ]).encode()
                content_type = "application/json"
            elif self.path == "/api/camera_proxy/camera.dynamic":
                body = b"\xff\xd8\xff\xd9"
                content_type = "image/jpeg"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *_args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        spec = importlib.util.spec_from_file_location("jarvis_provider_ha_verify", f"{ROOT}/jarvis_provider.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("jarvis_provider_import_failed")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        async def authorize(_context_token: str, provider: str, _tool_name: str, _read_only: bool) -> dict:
            if provider != "homeassistant":
                raise RuntimeError("homeassistant_provider_mismatch")
            return {"endpoint": f"http://127.0.0.1:{server.server_port}/api/mcp", "token": "ha-test-token"}

        module._authorize = authorize
        module._publish_media = lambda *_args: "20000000-0000-4000-8000-000000000002"
        cameras = json.loads(await module._homeassistant_cameras("context"))
        if [item["entity_id"] for item in cameras["cameras"]] != ["camera.dynamic"]:
            raise RuntimeError(f"homeassistant_camera_filter_mismatch:{cameras}")
        snapshot = json.loads(await module._homeassistant_camera_snapshot("context", "camera.dynamic"))
        if snapshot["media_resource"] != "MEDIA_RESOURCE:20000000-0000-4000-8000-000000000002":
            raise RuntimeError(f"homeassistant_media_resource_mismatch:{snapshot}")
        try:
            await module._homeassistant_camera_snapshot("context", "light.not_a_camera")
        except RuntimeError as exc:
            if str(exc) != "homeassistant_camera_entity_invalid":
                raise
        else:
            raise RuntimeError("homeassistant_non_camera_accepted")
        if received != [
            ("/api/states", "Bearer ha-test-token"),
            ("/api/camera_proxy/camera.dynamic", "Bearer ha-test-token"),
        ]:
            raise RuntimeError(f"homeassistant_request_mismatch:{received}")
    finally:
        server.shutdown()
        server.server_close()


async def tool_names(script: str, **extra_env: str) -> set[str]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "JARVIS_BRIDGE_KEY": "registration-test-only",
        **extra_env,
    }
    params = StdioServerParameters(command=PYTHON, args=[f"{ROOT}/{script}"], env=env)
    async with stdio_client(params) as streams:
        async with ClientSession(*streams) as session:
            await session.initialize()
            return {tool.name for tool in (await session.list_tools()).tools}


async def main() -> None:
    verify_immich_preview_fetch()
    await verify_homeassistant_camera_bridge()
    expected = {
        "jarvis": {
            "system_status_read", "system_metrics_read", "agent_list", "llm_usage_read",
            "agent_run_status", "ui_view_show", "task_create", "task_cancel",
            "schedule_create", "conversation_question_create",
        },
        "homeassistant": {"mcp_tools_list", "mcp_tool_call", "camera_entities_list", "camera_snapshot_read"},
        "immich": {"mcp_tools_list", "mcp_tool_call"},
    }
    actual = {
        "jarvis": await tool_names("jarvis_provider.py"),
        "homeassistant": await tool_names("upstream_provider.py", MCP_PROVIDER="homeassistant"),
        "immich": await tool_names("upstream_provider.py", MCP_PROVIDER="immich"),
    }
    for provider, names in actual.items():
        if names != expected[provider]:
            raise RuntimeError(f"{provider}_tool_registration_mismatch:{sorted(names)}")
    print("Jarvis MCP provider registration verified")


if __name__ == "__main__":
    asyncio.run(main())
