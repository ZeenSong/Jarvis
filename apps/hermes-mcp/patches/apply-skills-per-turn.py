#!/usr/bin/env python3
"""Apply Jarvis' per-run Skills enforcement to the pinned Hermes source tree.

Every replacement is guarded so a changed upstream image fails its build instead
of silently shipping a partial restriction.
"""

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


def add_request_context() -> None:
    path = ROOT / "gateway/request_skills.py"
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if "jarvis_requested_skills" in existing:
            return
        raise SystemExit("unexpected existing gateway/request_skills.py")
    path.write_text(
        '''"""Context-local allowlist for native Skills on one API run."""\n\n'''
        '''from contextvars import ContextVar, Token\n\n'''
        '''_REQUESTED_SKILLS: ContextVar[frozenset[str] | None] = ContextVar(\n'''
        '''    "jarvis_requested_skills", default=None)\n\n'''
        '''def set_requested_skills(skills: list[str] | None) -> Token:\n'''
        '''    return _REQUESTED_SKILLS.set(None if skills is None else frozenset(skills))\n\n'''
        '''def reset_requested_skills(token: Token) -> None:\n'''
        '''    _REQUESTED_SKILLS.reset(token)\n\n'''
        '''def get_requested_skills() -> frozenset[str] | None:\n'''
        '''    return _REQUESTED_SKILLS.get()\n''',
        encoding="utf-8",
    )


# Advertise that this image consumes the per-run `skills` allowlist.
replace_once(
    "gateway/platforms/api_server.py",
    '    "skills_api": True, "audio_api": False, "realtime_voice": False,\n',
    '    "skills_api": True, "skills_per_run": True, "audio_api": False, "realtime_voice": False,\n',
)

# Bind the request option all the way to AIAgent construction.
replace_once(
    "gateway/platforms/api_server.py",
    '        room_execution_policy: Optional[Dict[str, Any]] = None) -> Any:\n',
    '        room_execution_policy: Optional[Dict[str, Any]] = None,\n'
    '        requested_skills: Optional[List[str]] = None) -> Any:\n',
)
replace_once(
    "gateway/platforms/api_server.py",
    '            "reasoning_config": request_reasoning_config,\n'
    '            "gateway_session_key": gateway_session_key}\n',
    '            "reasoning_config": request_reasoning_config,\n'
    '            "gateway_session_key": gateway_session_key,\n'
    '            "requested_skills": requested_skills}\n',
)

# Keep the installed-skills endpoint on the same enumerator contract as the run validator.
replace_once(
    "gateway/platforms/api_server.py",
    '                _find_all_skills(\n'
    '                    skip_disabled=False, include_editorial=True\n'
    '                )\n',
    '                _find_all_skills()\n',
)

# Validate the caller's chosen skill names against the active profile before admitting a run.
replace_once(
    "gateway/platforms/api_server_runs.py",
    '    raw_input = body.get("input")\n',
    '    requested_skills = body.get("skills") if isinstance(body, dict) else None\n'
    '    if requested_skills is not None:\n'
    '        if (not isinstance(requested_skills, list) or not requested_skills\n'
    '            or len(requested_skills) > 16\n'
    '            or any(not isinstance(name, str) or not name.strip() for name in requested_skills)\n'
    '            or len(set(requested_skills)) != len(requested_skills)):\n'
    '            return _json_error(_openai_error, "Invalid Skills selection", code="invalid_skills", status=400)\n'
    '        try:\n'
    '            from tools.skills_tool import _find_all_skills\n'
    '            available_skills = {item.get("name") for item in _find_all_skills()}\n'
    '        except Exception:\n'
    '            return _json_error(_openai_error, "Skills are unavailable", code="skills_unavailable", status=503)\n'
    '        if any(name not in available_skills for name in requested_skills):\n'
    '            return _json_error(_openai_error, "Unknown or unavailable Skills selection", code="invalid_skills", status=400)\n'
    '    raw_input = body.get("input")\n',
)
replace_once(
    "gateway/platforms/api_server_runs.py",
    '            **{k: agent_overrides.get(k) for k in ("requested_model", "requested_provider", "model_options")}),\n',
    '            **{k: agent_overrides.get(k) for k in ("requested_model", "requested_provider", "model_options")},\n'
    '            requested_skills=requested_skills),\n',
)

# Context-local handler enforcement works for both sequential and context-propagated parallel tools.
replace_once(
    "gateway/platforms/api_server_runs.py",
    '    resets: list[tuple[Any, Callable]] = []\n'
    '    with self._profile_scope(run.request_profile):\n',
    '    resets: list[tuple[Any, Callable]] = []\n'
    '    skills_token = None\n'
    '    with self._profile_scope(run.request_profile):\n',
)
replace_once(
    "gateway/platforms/api_server_runs.py",
    '        try:\n'
    '            # Contextvars, not process env: concurrent runs must not share identity.\n',
    '        try:\n'
    '            from gateway.request_skills import set_requested_skills, reset_requested_skills\n'
    '            skills_token = set_requested_skills(run.agent_kwargs.get("requested_skills"))\n'
    '            # Contextvars, not process env: concurrent runs must not share identity.\n',
)
replace_once(
    "gateway/platforms/api_server_runs.py",
    '                for token, reset in resets:\n'
    '                    with suppress(Exception):\n'
    '                        reset(token)\n',
    '                for token, reset in resets:\n'
    '                    with suppress(Exception):\n'
    '                        reset(token)\n'
    '                reset_requested_skills(skills_token)\n',
)

# AIAgent stores the requested selection before prompt construction.
replace_once(
    "run_agent.py",
    '        capabilities: Dict[str, bool] | None = None, cwd: str | None = None,\n',
    '        capabilities: Dict[str, bool] | None = None, cwd: str | None = None,\n'
    '        requested_skills: List[str] | None = None,\n',
)
replace_once(
    "agent/agent_init.py",
    '    "enabled_toolsets", "disabled_toolsets",\n',
    '    "enabled_toolsets", "disabled_toolsets", "requested_skills",\n',
)
replace_once(
    "agent/agent_init.py",
    '    requested_provider: str = None, capabilities: Optional[Dict[str, bool]] = None, cwd: Optional[str] = None,\n',
    '    requested_provider: str = None, capabilities: Optional[Dict[str, bool]] = None, cwd: Optional[str] = None,\n'
    '    requested_skills: Optional[List[str]] = None,\n',
)

# Keep skill management unavailable during a turn that is explicitly scoped to selected Skills.
replace_once(
    "agent/agent_init.py",
    '    agent.valid_tool_names = {tool["function"]["name"] for tool in agent.tools} if agent.tools else set()\n',
    '    if agent.requested_skills is not None:\n'
    '        agent.tools = [tool for tool in (agent.tools or [])\n'
    '                       if tool.get("function", {}).get("name") != "skill_manage"]\n'
    '    agent.valid_tool_names = {tool["function"]["name"] for tool in agent.tools} if agent.tools else set()\n',
)

# Show only selected names in the model's native Skills index; include the selection in prompt-cache keys.
replace_once(
    "agent/system_prompt.py",
    '                                         compact_categories=_compact_cats or None, skills_dir_override=_agent_skills_dir(agent))\n',
    '                                         compact_categories=_compact_cats or None, skills_dir_override=_agent_skills_dir(agent),\n'
    '                                         include_names=getattr(agent, "requested_skills", None))\n',
)
replace_once(
    "agent/prompt_builder.py",
    '    compact_categories: "frozenset[str] | None" = None, skills_dir_override: "Path | None" = None,\n'
    ') -> str:\n',
    '    compact_categories: "frozenset[str] | None" = None, skills_dir_override: "Path | None" = None,\n'
    '    include_names: "list[str] | None" = None,\n'
    ') -> str:\n',
)
replace_once(
    "agent/prompt_builder.py",
    '            skills_dir, external_dirs, available_tools, available_toolsets, compact_categories, project_dirs)\n',
    '            skills_dir, external_dirs, available_tools, available_toolsets, compact_categories, project_dirs, include_names)\n',
)
replace_once(
    "agent/prompt_builder.py",
    '    project_dirs: "list[Path] | None" = None,\n) -> str:\n',
    '    project_dirs: "list[Path] | None" = None, include_names: "list[str] | None" = None,\n) -> str:\n',
)
replace_once(
    "agent/prompt_builder.py",
    '        _platform_hint, tuple(sorted(disabled)), tuple(sorted(compact_categories or ())),\n',
    '        _platform_hint, tuple(sorted(disabled)), tuple(sorted(compact_categories or ())),\n'
    '        tuple(sorted(include_names)) if include_names is not None else None,\n',
)
replace_once(
    "agent/prompt_builder.py",
    '    result = _render_skills_index(skills_by_category, category_descriptions, compact_categories, available_tools)\n',
    '    if include_names is not None:\n'
    '        allowed_names = frozenset(include_names)\n'
    '        skills_by_category = {category: [entry for entry in entries if entry[0] in allowed_names]\n'
    '                              for category, entries in skills_by_category.items()}\n'
    '        skills_by_category = {category: entries for category, entries in skills_by_category.items() if entries}\n'
    '    result = _render_skills_index(skills_by_category, category_descriptions, compact_categories, available_tools)\n',
)

# The skill discovery and content tools enforce the same request-local allowlist.
replace_once(
    "tools/skills_tool.py",
    '        if not all_skills:\n',
    '        from gateway.request_skills import get_requested_skills\n'
    '        requested = get_requested_skills()\n'
    '        if requested is not None:\n'
    '            all_skills = [skill for skill in all_skills if skill.get("name") in requested]\n'
    '        if not all_skills:\n',
)
replace_once(
    "tools/skills_tool.py",
    '    try:\n'
    '        # Validate before the \':\' dispatch so a Windows drive path (C:\\skills\\foo) can\'t be\n'
    '        # reinterpreted as a plugin namespace.\n'
    '        if lookup_error := _skill_lookup_path_error(name):\n',
    '    try:\n'
    '        from gateway.request_skills import get_requested_skills\n'
    '        requested = get_requested_skills()\n'
    '        if requested is not None and name not in requested:\n'
    '            return _fail(f"Skill \'{name}\' was not selected for this run.", code="skill_not_selected")\n'
    '        # Validate before the \':\' dispatch so a Windows drive path (C:\\skills\\foo) can\'t be\n'
    '        # reinterpreted as a plugin namespace.\n'
    '        if lookup_error := _skill_lookup_path_error(name):\n',
)

# Assert the patched request path is wired before the image is accepted.
assert "requested_skills=requested_skills" in (ROOT / "gateway/platforms/api_server_runs.py").read_text(encoding="utf-8")
assert 'include_names=getattr(agent, "requested_skills", None)' in (ROOT / "agent/system_prompt.py").read_text(encoding="utf-8")
assert 'code="skill_not_selected"' in (ROOT / "tools/skills_tool.py").read_text(encoding="utf-8")
add_request_context()
print("Jarvis per-run Skills allowlist patch applied")
