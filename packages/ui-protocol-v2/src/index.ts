import { z } from "zod";

export const UI_PROTOCOL = "2.0" as const;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/);
const version = z.string().regex(/^\d+\.\d+$/);
export const componentTypes = [
  "metric", "metric_group", "sparkline", "line_chart", "bar_chart",
  "donut", "gauge", "progress", "status", "list", "data_table",
  "timeline", "alert", "card", "gallery", "photo_grid", "file_list",
  "log", "code_diff", "task", "run", "run_graph", "approval", "markdown", "action", "app",
  "empty_state", "error_state",
] as const;
export const componentRegistry = Object.freeze(Object.fromEntries(
  componentTypes.map((type) => [type, { version: 2, platforms: ["web", "android"] as const }]),
));

export const uiActionSchema = z.object({
  id,
  label: z.string().min(1).max(100),
  capability: id,
  resource_id: id.optional(),
  input: z.record(z.string(), z.json()).default({}),
  risk: z.enum(["read", "write", "dangerous"]),
  approval_id: id.optional(),
}).strict();

export const sectionSchema = z.object({
  id,
  role: z.enum(["summary", "primary", "activity", "resources", "detail", "actions"]),
  // Unknown identifiers remain parseable so older renderers can show fallback.
  component: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  component_version: z.number().int().positive().default(2),
  title: z.string().max(200),
  source: id.optional(),
  source_path: z.string().max(500).optional(),
  source_revision: z.number().int().nonnegative().optional(),
  data: z.json().optional(),
  actions: z.array(uiActionSchema).max(20).default([]),
  fallback: z.string().min(1).max(4000),
  priority: z.number().int().min(0).max(100).default(50),
}).strict();

export const viewSpecSchema = z.object({
  ui_protocol: z.literal(UI_PROTOCOL),
  id,
  revision: z.number().int().nonnegative(),
  intent: z.enum(["overview", "investigate_failure", "manage_application", "search", "review_task", "review_integration"]),
  title: z.string().min(1).max(200),
  task_id: id.optional(),
  layout: z.object({
    type: z.enum(["page", "workspace", "detail"]),
  }).strict(),
  sections: z.array(sectionSchema).max(60),
  fallback: z.string().min(1).max(10000),
}).strict().superRefine((view, ctx) => {
  const ids = new Set<string>();
  view.sections.forEach((section, index) => {
    if (ids.has(section.id)) ctx.addIssue({ code: "custom", path: ["sections", index, "id"], message: "Duplicate section ID" });
    ids.add(section.id);
  });
});

export const rendererSchema = z.object({
  platform: z.enum(["web", "android"]),
  supports: z.object({ min: version, max: version }).strict(),
  components: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}@\d+$/)).max(200),
  features: z.array(z.enum(["charts", "gallery", "actions"])).default([]),
}).strict();
export type ViewSpec = z.infer<typeof viewSpecSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Renderer = z.infer<typeof rendererSchema>;

function compare(a: string, b: string) {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am - bm || an - bn;
}

/** Presentation negotiation never grants permission to execute an action. */
export function negotiateView(input: unknown, clientInput: unknown):
  | { kind: "view"; view: ViewSpec; degraded: string[] }
  | { kind: "fallback"; title: string; text: string; reason: string } {
  const view = viewSpecSchema.parse(input);
  const client = rendererSchema.parse(clientInput);
  if (compare(client.supports.min, client.supports.max) > 0) {
    throw new Error("Invalid renderer protocol range");
  }
  if (compare(UI_PROTOCOL, client.supports.min) < 0 || compare(UI_PROTOCOL, client.supports.max) > 0) {
    return { kind: "fallback", title: view.title, text: view.fallback, reason: "unsupported_protocol" };
  }
  const supported = new Set(client.components);
  const degraded: string[] = [];
  const sections = view.sections.map((section): Section => {
    const feature = /chart|sparkline|donut|gauge/.test(section.component) ? "charts"
      : /gallery|photo_grid/.test(section.component) ? "gallery" : undefined;
    if (!Object.hasOwn(componentRegistry, section.component) ||
        !supported.has(`${section.component}@${section.component_version}`) ||
        (feature && !client.features.includes(feature))) {
      degraded.push(section.id);
      return { ...section, component: "markdown", component_version: 2, source: undefined,
        data: { text: section.fallback }, actions: [] };
    }
    return { ...section, actions: client.features.includes("actions") ? section.actions : [] };
  });
  // Markdown fallback is a mandatory baseline; otherwise return plain text.
  if (degraded.length && !supported.has("markdown@2")) {
    return { kind: "fallback", title: view.title, text: view.fallback, reason: "unsupported_components" };
  }
  return { kind: "view", view: { ...view, sections }, degraded };
}

/** Semantic placement, not pixel layouts. Detail/actions become mobile sheets. */
export function arrangeSections(view: ViewSpec, platform: Renderer["platform"]) {
  const sections = [...view.sections].sort((a, b) => b.priority - a.priority);
  if (platform === "android") {
    const order = ["summary", "primary", "activity", "resources"];
    return {
      main: sections.filter((s) => order.includes(s.role)).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)),
      sheet: sections.filter((s) => s.role === "detail" || s.role === "actions"),
    };
  }
  return {
    left: sections.filter((s) => s.role === "activity"),
    main: sections.filter((s) => s.role === "summary" || s.role === "primary"),
    right: sections.filter((s) => ["resources", "detail", "actions"].includes(s.role)),
  };
}
