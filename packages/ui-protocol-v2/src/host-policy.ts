/**
 * Result host policy.
 *
 * A result is either rendered inline in the turn or hosted in the workspace side
 * panel. That decision used to belong to the model: `ui_view_show` defaulted to
 * `workspace`, and the MCP tool description actively told the model to author a
 * workspace layout. As a result a three-photo answer opened a workspace, which
 * violates the product rule:
 *
 *   "一次看完、不需要继续复杂操作的结果留在 Conversation。
 *    复杂、多维、需要持续交互的结果进入 Workspace。"
 *   — docs/specifications/m3.3-requirements.md §11
 *
 * The decision is now a deterministic function of the result's shape. The caller's
 * `target` is only a tie-break, never an override, so a model cannot accidentally
 * turn a gallery into a workspace or skip the workspace for a multi-chart report.
 */

export type ResultHost = "inline" | "workspace";

export type HostCandidate = {
  component: string;
  /** Optional section payload; only used for bounded size heuristics. */
  data?: unknown;
};

export type HostDecision = {
  target: ResultHost;
  /** Machine-readable reason, surfaced in tests and in developer mode. */
  reason: string;
};

/** Components that are meaningful only as a multi-part analysis surface. */
export const WORKSPACE_ONLY_INTENTS: ReadonlySet<string> = new Set([
  "review_task",
  "investigate_failure",
  "manage_application",
  "review_integration",
]);

/**
 * Intents with documented host semantics. `intent` itself is open, so a new
 * result shape can describe itself without a protocol release; these are the
 * names that change the inline/workspace decision.
 */
export const knownIntents: readonly string[] = ["overview", "search", ...WORKSPACE_ONLY_INTENTS];

const MEDIA_COMPONENTS = new Set(["gallery", "photo_grid", "file_list"]);
const CHART_COMPONENTS = new Set(["line_chart", "bar_chart", "area_chart", "donut"]);
const HEAVY_COMPONENTS = new Set(["run_graph", "code_diff", "log", "run"]);
const TABLE_COMPONENTS = new Set(["data_table", "list"]);
const TIMELINE_COMPONENTS = new Set(["timeline"]);

/** Maximum media items that still read as "view it and you are done". */
const INLINE_MEDIA_LIMIT = 5;
/** A section with more entries than this is multi-dimensional. */
const INLINE_ROW_LIMIT = 8;
/** Sections beyond this are a report, not an answer. */
const INLINE_SECTION_LIMIT = 6;

function itemCount(data: unknown): number | undefined {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    for (const key of ["items", "photos", "rows", "sections", "entries", "results"]) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value.length;
    }
    return Object.keys(data as Record<string, unknown>).length;
  }
  return undefined;
}

/**
 * Decide where a result lives.
 *
 * `requested` is honoured only when the shape is genuinely ambiguous, so an
 * explicit inline request cannot suppress a workspace for a multi-chart report.
 */
export function decideResultHost(
  sections: readonly HostCandidate[],
  options: { intent?: string; layout?: "page" | "workspace" | "detail"; requested?: ResultHost } = {},
): HostDecision {
  const { intent = "", layout, requested } = options;
  const components = sections.map((section) => section.component);

  if (WORKSPACE_ONLY_INTENTS.has(intent)) {
    return { target: "workspace", reason: "intent_requires_workspace" };
  }
  if (components.some((component) => HEAVY_COMPONENTS.has(component))) {
    return { target: "workspace", reason: "heavy_component" };
  }

  const charts = components.filter((component) => CHART_COMPONENTS.has(component)).length;
  const tables = components.filter((component) => TABLE_COMPONENTS.has(component)).length;
  const timelines = components.filter((component) => TIMELINE_COMPONENTS.has(component)).length;
  const media = components.filter((component) => MEDIA_COMPONENTS.has(component)).length;
  const mediaItems = Math.max(
    0,
    ...sections
      .filter((section) => MEDIA_COMPONENTS.has(section.component))
      .map((section) => itemCount(section.data) ?? 0),
  );
  const oversizedData = sections.some(
    (section) => Array.isArray(section.data) && section.data.length > INLINE_ROW_LIMIT,
  );

  if (media > 0) {
    if (mediaItems > INLINE_MEDIA_LIMIT) {
      return { target: "workspace", reason: "media_over_inline_limit" };
    }
    // Photos (and small file lists) are "look once and you are done". Supporting
    // prose and action buttons do not turn a gallery into a workspace.
    if (charts === 0 && tables === 0 && timelines === 0) {
      return { target: "inline", reason: "media_gallery" };
    }
  }

  if (charts >= 2) return { target: "workspace", reason: "multiple_charts" };
  if (charts >= 1 && (tables > 0 || timelines > 0)) {
    return { target: "workspace", reason: "chart_with_detail" };
  }
  if (timelines > 0 && components.length > 3) {
    return { target: "workspace", reason: "timeline_with_context" };
  }
  if (oversizedData) return { target: "workspace", reason: "large_dataset" };
  if (components.length > INLINE_SECTION_LIMIT) {
    return { target: "workspace", reason: "many_sections" };
  }
  if (layout === "workspace" && (charts > 0 || tables > 0 || timelines > 0)) {
    return { target: "workspace", reason: "authored_workspace_layout" };
  }
  if (layout === "workspace" && components.length <= 3 && media === 0) {
    // A single metric card authored as a workspace is still an inline answer.
    return { target: "inline", reason: "single_metric_authored_workspace" };
  }

  if (requested) return { target: requested, reason: "caller_preference" };
  return { target: "inline", reason: "default_inline" };
}

/** Convenience wrapper for a full ViewSpec-shaped object. */
export function decideViewHost(
  view: { intent?: string; layout?: { type?: "page" | "workspace" | "detail" }; sections: readonly { component: string; data?: unknown }[] },
  requested?: ResultHost,
): HostDecision {
  return decideResultHost(
    view.sections.map((section) => ({ component: section.component, data: section.data })),
    { intent: view.intent, layout: view.layout?.type, requested },
  );
}
