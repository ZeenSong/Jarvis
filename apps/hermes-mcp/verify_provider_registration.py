#!/usr/bin/env python3
"""Fail an image build when a Jarvis MCP entry point registers another server's
tools, or when the transport contract drifts from what the server sends."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


# Overridable so the same checks can run against a working tree before an image
# build, not only inside it.
PYTHON = os.environ.get("JARVIS_PROVIDER_PYTHON", "/opt/hermes/.venv/bin/python")
ROOT = os.environ.get("JARVIS_PROVIDER_SOURCE", "/opt/jarvis-source")
ASSET_ID = "10000000-0000-4000-8000-000000000001"
MEDIA_ID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"


def _load(name: str = "jarvis_provider_verify"):
    spec = importlib.util.spec_from_file_location(name, f"{ROOT}/jarvis_provider.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("jarvis_provider_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _serve(handler: type[BaseHTTPRequestHandler]) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def verify_media_fetch() -> None:
    received: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            received["path"] = self.path
            received["key"] = self.headers.get("x-api-key", "")
            if self.path.endswith("/thumbnail?size=preview"):
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.end_headers()
                self.wfile.write(b"\xff\xd8\xff\xd9")
            else:
                self.send_error(404)

        def log_message(self, _format: str, *_args: object) -> None:
            pass

    server = _serve(Handler)
    try:
        module = _load()
        descriptor = {
            "tool": "immich_assets_download_thumbnail",
            "id_argument": "id",
            "url_template": f"http://127.0.0.1:{server.server_port}/api/assets/{{id}}/thumbnail?size=preview",
            "headers": {"x-api-key": "private-test-key"},
            "content_types": ["image/jpeg", "image/png", "image/webp"],
            "max_bytes": 2 * 1024 * 1024,
            "id_pattern": MEDIA_ID_PATTERN,
        }
        data, content_type = module._fetch_media(descriptor, "immich", ASSET_ID)
        if data != b"\xff\xd8\xff\xd9" or content_type != "image/jpeg":
            raise RuntimeError("media_fetch_response_mismatch")
        if received != {"path": f"/api/assets/{ASSET_ID}/thumbnail?size=preview", "key": "private-test-key"}:
            raise RuntimeError(f"media_fetch_request_mismatch:{received}")
        # The descriptor owns id validation: a mismatching id never reaches a URL.
        for bad in ("../../etc/passwd", "not-a-uuid", ""):
            try:
                module._fetch_media(descriptor, "immich", bad)
            except RuntimeError as exc:
                if str(exc) != "media_id_invalid":
                    raise
            else:
                raise RuntimeError(f"media_id_accepted:{bad}")
    finally:
        server.shutdown()
        server.server_close()


async def _consume(context) -> None:
    async with context:
        pass


async def verify_transport_contract() -> None:
    module = _load("jarvis_provider_transport_verify")
    cases = (
        ({}, "mcp_transport_missing"),
        ({"transport": {"type": "carrier-pigeon"}}, "mcp_transport_invalid"),
        ({"transport": {"type": "streamable-http", "endpoint": "not-a-url"}}, "mcp_transport_invalid"),
    )
    for config, expected in cases:
        try:
            await _consume(module._upstream("immich", config))
        except RuntimeError as exc:
            if str(exc) != expected:
                raise RuntimeError(f"transport_contract_mismatch:{expected}:{exc}")
        else:
            raise RuntimeError(f"transport_contract_accepted:{config}")


async def verify_camera_bridge() -> None:
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

    server = _serve(Handler)
    try:
        module = _load("jarvis_provider_ha_verify")

        async def authorize(_context_token: str, provider: str, _tool_name: str, _read_only: bool) -> dict:
            if provider != "homeassistant":
                raise RuntimeError("homeassistant_provider_mismatch")
            # Exactly the shape the server's mcp_authorize returns today.
            return {
                "transport": {
                    "type": "streamable-http",
                    "endpoint": f"http://127.0.0.1:{server.server_port}/api/mcp",
                    "headers": {"Authorization": "Bearer ha-test-token"},
                },
            }

        module._authorize = authorize
        module._publish_media = lambda *_args: "20000000-0000-4000-8000-000000000002"
        cameras = json.loads(await module._camera_entities("context", "homeassistant"))
        if [item["entity_id"] for item in cameras["cameras"]] != ["camera.dynamic"]:
            raise RuntimeError(f"homeassistant_camera_filter_mismatch:{cameras}")
        snapshot = json.loads(await module._camera_snapshot("context", "homeassistant", "camera.dynamic"))
        if snapshot["media_resource"] != "MEDIA_RESOURCE:20000000-0000-4000-8000-000000000002":
            raise RuntimeError(f"homeassistant_media_resource_mismatch:{snapshot}")
        try:
            await module._camera_snapshot("context", "homeassistant", "light.not_a_camera")
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
    verify_media_fetch()
    await verify_transport_contract()
    await verify_camera_bridge()
    expected = {
        "jarvis": {
            "system_status_read", "system_metrics_read", "agent_list", "llm_usage_read",
            "agent_run_status", "ui_view_show", "task_create", "task_cancel",
            "schedule_create", "conversation_question_create",
        },
        # The generic bridge exposes the same two tools for every provider; only
        # the opt-in extras differ. That is what makes a new integration a
        # configuration change rather than a new entry point.
        "homeassistant": {"mcp_tools_list", "mcp_tool_call", "camera_entities_list", "camera_snapshot_read"},
        "immich": {"mcp_tools_list", "mcp_tool_call"},
    }
    actual = {
        "jarvis": await tool_names("jarvis_provider.py"),
        "homeassistant": await tool_names("upstream_provider.py", MCP_PROVIDER="homeassistant", MCP_EXTRAS="camera"),
        "immich": await tool_names("upstream_provider.py", MCP_PROVIDER="immich"),
    }
    for provider, names in actual.items():
        if names != expected[provider]:
            raise RuntimeError(f"{provider}_tool_registration_mismatch:{sorted(names)}")
    # A provider nobody has written code for still registers the generic bridge.
    if await tool_names("upstream_provider.py", MCP_PROVIDER="new-app") != {"mcp_tools_list", "mcp_tool_call"}:
        raise RuntimeError("generic_provider_registration_mismatch")
    print("Jarvis MCP provider registration verified")


if __name__ == "__main__":
    asyncio.run(main())
