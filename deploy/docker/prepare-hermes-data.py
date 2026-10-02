#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import shutil
import subprocess
from pathlib import Path

import yaml
from dotenv import set_key


home = Path(os.environ.get("HERMES_HOME", "/opt/data"))
source_config = Path("/opt/jarvis-compose/hermes-config.yaml")
home.mkdir(parents=True, exist_ok=True)
shutil.copy2(source_config, home / "config.yaml")

base_key = os.environ["API_SERVER_KEY"]
profile_key = os.environ.get("JARVIS_PROFILE_API_KEY") or base64.urlsafe_b64encode(
    hmac.new(base_key.encode(), b"hermes-profile:jarvis", hashlib.sha256).digest()
).rstrip(b"=").decode()

root_env = home / ".env"
root_env.touch(exist_ok=True)
root_env.chmod(0o600)
set_key(str(root_env), "API_SERVER_KEY", base_key)
os.chown(root_env, 10000, 10000)

profile_dir = home / "profiles" / "jarvis"
if not profile_dir.exists():
    subprocess.run(
        ["hermes", "profile", "create", "jarvis", "--clone", "--description", "Jarvis personal cloud coordinator"],
        check=True,
        env={**os.environ, "HERMES_HOME": str(home)},
    )
profile_config_path = profile_dir / "config.yaml"
if not profile_config_path.exists():
    raise RuntimeError("Jarvis Hermes profile exists but is incomplete")

profile_env = profile_dir / ".env"
profile_env.touch(exist_ok=True)
profile_env.chmod(0o600)
set_key(str(profile_env), "API_SERVER_KEY", profile_key)
set_key(str(profile_env), "JARVIS_INTERNAL_URL", os.environ["JARVIS_INTERNAL_URL"])
set_key(str(profile_env), "JARVIS_BRIDGE_KEY", os.environ["JARVIS_BRIDGE_KEY"])
os.chown(profile_env, 10000, 10000)

with profile_config_path.open(encoding="utf-8") as handle:
    profile_config = yaml.safe_load(handle) or {}
with (home / "config.yaml").open(encoding="utf-8") as handle:
    base_config = yaml.safe_load(handle) or {}
if not isinstance(profile_config, dict) or not isinstance(base_config.get("mcp_servers"), dict):
    raise RuntimeError("Hermes profile configuration is invalid")
profile_config["mcp_servers"] = base_config["mcp_servers"]
profile_config["gateway"] = base_config.get("gateway", {"multiplex_profiles": False})
with profile_config_path.open("w", encoding="utf-8") as handle:
    yaml.safe_dump(profile_config, handle, sort_keys=False, allow_unicode=True)

(profile_dir / "SOUL.md").write_text(
    "You are Jarvis, the user's personal cloud coordinator. Use your configured Hermes Skills, MCP servers, and tools. "
    "Use the Jarvis MCP server for authoritative Jarvis state, permissions, UI views, and durable tasks. Keep small, "
    "immediate work in the current response. Create a durable task when the goal benefits from continuing independently, "
    "cross-stage progress, waiting on external state, or explicit background execution. Describe required capabilities and "
    "risk constraints; never select an executor by a hard-coded agent name. Preserve "
    "MEDIA_RESOURCE markers returned by approved photo tools. For Home Assistant cameras, discover the current camera "
    "entities at request time and never assume or cache a device, entity, or area. Never create public photo sharing "
    "links or expose local filesystem paths. Be concise, truthful, and never invent unavailable state.\n",
    encoding="utf-8",
)

media_tmp = home / "media" / "tmp"
media_tmp.mkdir(parents=True, exist_ok=True)
for profile_path, desired_state in ((home, "stopped"), (profile_dir, "running")):
    state_path = profile_path / "gateway_state.json"
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    state["desired_state"] = desired_state
    state_path.write_text(json.dumps(state, separators=(",", ":")) + "\n", encoding="utf-8")

subprocess.run(
    ["hermes", "-p", "jarvis", "chat", "-c", "Bot Chat", "--create-if-missing"],
    check=True,
    env={**os.environ, "HERMES_HOME": str(home)},
)
