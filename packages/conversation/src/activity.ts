// Explicit provider aliases, not fuzzy name matching. The capability endpoint
// and Hermes wrapper have independent call IDs: never merge their records.
const capabilities: Record<string, [string, string]> = {
  system_status_read: ["system.status.read", "读取服务器状态"],
  system_metrics_read: ["system.metrics.read", "读取服务器指标"],
  agent_list: ["agent.list", "查看智能体"],
  llm_usage_read: ["llm.usage.read", "查看用量"],
  agent_run_status: ["agent.run.status", "查看任务进度"],
  ui_view_show: ["ui.view.show", "打开工作区"],
  task_create: ["task.create", "创建任务"],
  task_cancel: ["task.cancel", "取消任务"],
  home_assistant_state: ["homeassistant.state.read", "读取家庭状态"],
  mcp_tools_list: ["mcp.tools.list", "读取上游工具清单"],
  mcp_tool_call: ["mcp.tool.call", "调用上游 MCP"],
  frigate_events_read: ["frigate.events.read", "查看监控事件"],
  frigate_event_snapshot_read: ["frigate.event.snapshot.read", "查看监控快照"],
  immich_photo_search: ["immich.photo.search", "搜索照片"],
  schedule_create: ["schedule.create", "创建定时任务"],
  conversation_question_create: ["conversation.question.create", "等待你的选择"],
};

function wrapperTool(capability: string) {
  const match = /^(?:mcp_jarvis_|mcp__jarvis__)(.+)$/.exec(capability);
  return match && Object.hasOwn(capabilities, match[1]) ? match[1] : undefined;
}

function definition(capability: string) {
  return capabilities[wrapperTool(capability) ?? capability]
    ?? Object.values(capabilities).find(([canonical]) => canonical === capability);
}

export function canonicalActivityCapability(capability: string) {
  return definition(capability)?.[0] ?? capability;
}

export function capabilityLabel(capability: string) {
  return definition(capability)?.[1] ?? "执行操作";
}

export function activitySource(capability: string) {
  return wrapperTool(capability) ? "hermes_wrapper" : "execution";
}

// Choose one instrumentation layer for ordinary users; this is deliberately
// not call deduplication. Keep every execution, even with identical names/input.
// Unknown/native tools remain visible. Developer mode retains every raw record.
export function visibleActivities<T extends { capability: string; status?: string }>(activities: readonly T[], developer = false): T[] {
  // Hide only successful wrapper noise. Pending approvals/progress and failures
  // must remain visible, even with a same-name inner execution: independent IDs
  // cannot prove the inner record accounts for the outer state.
  return activities.filter((activity) => developer || activitySource(activity.capability) !== "hermes_wrapper"
    || activity.status !== "completed");
}
