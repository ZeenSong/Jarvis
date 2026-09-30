#!/usr/bin/env python3
"""Expose Hermes' provider reasoning deltas through the authenticated run SSE."""

from pathlib import Path


ROOT = Path("/opt/hermes")


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    source = path.read_text(encoding="utf-8")
    if new in source:
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"expected one patch target in {relative}, found {count}: {old[:120]!r}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


# The run API currently receives only completed reasoning through
# tool_progress_callback. Wire AIAgent's native reasoning callback to that same
# authenticated, durable run stream as distinct delta events.
replace_once(
    "gateway/platforms/api_server.py",
    "        room_execution_policy: Optional[Dict[str, Any]] = None,\n"
    "        requested_skills: Optional[List[str]] = None) -> Any:\n",
    "        room_execution_policy: Optional[Dict[str, Any]] = None,\n"
    "        requested_skills: Optional[List[str]] = None, reasoning_callback=None) -> Any:\n",
)
replace_once(
    "gateway/platforms/api_server.py",
    '            "stream_delta_callback": stream_delta_callback,\n'
    '            "tool_progress_callback": tool_progress_callback,\n',
    '            "stream_delta_callback": stream_delta_callback,\n'
    '            "reasoning_callback": reasoning_callback,\n'
    '            "tool_progress_callback": tool_progress_callback,\n',
)

# Forward raw reasoning deltas through the run's existing thread-safe SSE queue.
replace_once(
    "gateway/platforms/api_server_runs.py",
    '    "reasoning.available": lambda tool, preview, kw: {"text": preview or ""}}\n',
    '    "reasoning.delta": lambda tool, preview, kw: {"delta": preview or ""},\n'
    '    "reasoning.available": lambda tool, preview, kw: {"text": preview or ""}}\n',
)
replace_once(
    "gateway/platforms/api_server_runs.py",
    '            agent = self._create_agent(\n'
    '                stream_delta_callback=_text_cb, tool_progress_callback=self._make_run_event_callback(run_id, loop),\n'
    '                **run.agent_kwargs)\n',
    '            run_event_callback = self._make_run_event_callback(run_id, loop)\n'
    '            agent = self._create_agent(\n'
    '                stream_delta_callback=_text_cb,\n'
    '                reasoning_callback=lambda text: run_event_callback("reasoning.delta", "_thinking", text),\n'
    '                tool_progress_callback=run_event_callback,\n'
    '                **run.agent_kwargs)\n',
)

# Do not truncate completed-only providers: streaming providers are coalesced
# into the same Jarvis segment, while this event remains the full-text fallback.
replace_once(
    "agent/turn_response_intake.py",
    '            agent.tool_progress_callback("reasoning.available", "_thinking", _think_text[:500], None)\n',
    '            agent.tool_progress_callback("reasoning.available", "_thinking", _think_text, None)\n',
)

api_server = (ROOT / "gateway/platforms/api_server.py").read_text(encoding="utf-8")
run_source = (ROOT / "gateway/platforms/api_server_runs.py").read_text(encoding="utf-8")
intake = (ROOT / "agent/turn_response_intake.py").read_text(encoding="utf-8")
assert '"reasoning_callback": reasoning_callback' in api_server
assert '"reasoning.delta": lambda tool, preview, kw: {"delta": preview or ""}' in run_source
assert 'reasoning_callback=lambda text: run_event_callback("reasoning.delta", "_thinking", text)' in run_source
assert "_think_text[:500]" not in intake
print("Jarvis provider reasoning stream patch applied")
