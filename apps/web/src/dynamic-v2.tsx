import { Blocks } from "./blocks";
import { useState, useEffect, type ReactNode } from "react";
import { parseWorkspaceLayout } from "./workspace-layout";
import { WorkspaceDivider } from "./workspace-divider";
import { RiskAction } from "./risk-action";
import { SectionBoundary } from "./section-boundary";
import { TimelineView } from "./timeline-view";
import { GalleryView } from "./gallery-view";
import { LogView } from "./log-view";
import { ListView } from "./list-view";
import { TaskView } from "./task-view";
import { arrangeSections, viewSpecSchema, type Section } from "../../../packages/ui-protocol-v2/src/index";
import { bindSection } from "../../../packages/ui-protocol-v2/src/binding";
import { blockTypes, actionSchema, type Resource, type ViewSpec } from "../../../packages/ui-protocol/src/index";

const supported = [...blockTypes.filter((c) => c !== "table" && c !== "status_grid"), "data_table", "status", "log", "list", "task", "gallery", "photo_grid"];
export const webRenderer = { platform: "web", supports: { min: "2.0", max: "2.0" }, components: supported.map((c) => `${c}@2`), features: ["charts", "actions", "gallery"] };

export function DynamicView({ value, action, liveResources }: { value: unknown; action: (a: any) => void; liveResources?: Map<string, Resource> }) {
  const [initialLayout] = useState(() => {
    try { return parseWorkspaceLayout(localStorage.getItem("jarvis-workspace-layout")); }
    catch { return parseWorkspaceLayout(null); }
  });
  const [activityVisible, setActivityVisible] = useState(initialLayout.activityVisible);
  const [inspectorVisible, setInspectorVisible] = useState(initialLayout.inspectorVisible);
  const [panelWidth, setPanelWidth] = useState(initialLayout.panelWidth);
  useEffect(() => {
    try { localStorage.setItem("jarvis-workspace-layout", JSON.stringify({ activityVisible, inspectorVisible, panelWidth })); }
    catch { /* Layout remains usable when browser storage is unavailable. */ }
  }, [activityVisible, inspectorVisible, panelWidth]);
  const parsed = viewSpecSchema.safeParse(value);
  if (!parsed.success) return <p role="status">此视图暂时无法显示，请刷新或更新客户端。</p>;
  const view = parsed.data;
  const layout = arrangeSections(view, "web");
  const render = (section: Section): ReactNode => {
    const revision = section.source ? liveResources?.get(section.source)?.revision ?? section.source_revision : undefined;
    return <SectionBoundary key={section.id} resetKey={`${view.id}:${view.revision}:${revision}`} title={section.title} fallback={section.fallback}>{renderContent(section)}</SectionBoundary>;
  };
  const renderContent = (section: Section): ReactNode => {
    if (section.component_version !== 2) return <p key={section.id}>{section.fallback}</p>;
    if (section.component === "action" && section.actions.length > 1) return <section key={section.id} className="semantic-action-group" aria-label={section.title}>
      {section.actions.map((item) => render({ ...section, id: `${section.id}-${item.id}`, title: item.label, actions: [item] }))}
    </section>;
    const live = section.source ? liveResources?.get(section.source) : undefined;
    if (live) section = bindSection(section, { ...live, revision: Number(live.revision) });
    if (["gallery", "photo_grid"].includes(section.component)) return <div className="semantic-section" key={section.id} data-component={section.component}><GalleryView title={section.title} data={section.data} fallback={section.fallback}/></div>;
    if (section.component === "timeline") return <div className="semantic-section" key={section.id} data-component="timeline"><TimelineView title={section.title} data={section.data} fallback={section.fallback} /></div>;
    if (section.component === "task" && section.component_version === 2) return <div className="semantic-section" key={section.id} data-component="task" data-wide="true"><TaskView title={section.title} data={section.data} fallback={section.fallback} /></div>;
    if (section.component === "list" && section.component_version === 2) return <div className="semantic-section" key={section.id} data-component="list"><ListView title={section.title} data={section.data} fallback={section.fallback} /></div>;
    if (section.component === "log" && section.component_version === 2) return <div className="semantic-section" key={section.id} data-component="log"><LogView title={section.title} data={section.data} fallback={section.fallback} /></div>;
    const type = section.component === "data_table" ? "table" : section.component === "status" ? "status_grid" : section.component === "log" ? "markdown" : section.component;
    if (!blockTypes.includes(type as any)) return <section className="block" key={section.id}><h3>{section.title}</h3><p>{section.fallback}</p></section>;
    const a = section.actions[0];
    const legacyAction = a ? actionSchema.safeParse({ ...a.input, type: a.capability, target: a.resource_id }) : undefined;
    const data = section.component === "log" && typeof section.data !== "string" ? section.fallback : section.data;
    const spec: ViewSpec = { version: 1, type: "dashboard", title: view.title, blocks: [{ type: type as any, title: section.title, resource: "system/status",
      ...(legacyAction?.success ? { action: legacyAction.data } : {}) }] };
    if (type === "action" && !legacyAction?.success) return <p key={section.id}>{section.fallback}</p>;
    const resources = new Map<string, Resource>([["system/status", { version: 1, resource: "system/status", revision: view.revision, data } as Resource]]);
    return <div className="semantic-section" key={section.id} data-component={section.component} data-wide={typeof section.data === "object" && section.data !== null ? "true" : undefined}>{a?.risk === "dangerous" ?
      <RiskAction key={JSON.stringify(a)} title={a.label} target={a.resource_id} action={action}>{(invoke) => <Blocks view={spec} resources={resources} action={invoke} />}</RiskAction> : <Blocks view={spec} resources={resources} action={action} />}</div>;
  };
  const hasPanels = !!layout.left?.length || !!layout.right?.length;
  return <>
    {hasPanels && <div className="workspace-controls" role="group" aria-label="工作区面板">
      {!!layout.left?.length && <button aria-pressed={activityVisible} onClick={() => setActivityVisible(!activityVisible)}>执行过程</button>}
      {!!layout.right?.length && <button aria-pressed={inspectorVisible} onClick={() => setInspectorVisible(!inspectorVisible)}>资源与操作</button>}
      <label className="workspace-width">侧栏宽度<input type="range" aria-label="工作区侧栏宽度" min="18" max="30" step="1" value={panelWidth} onChange={(event) => setPanelWidth(Number(event.target.value))} /><output>{panelWidth}%</output></label>
      <button onClick={() => { setActivityVisible(true); setInspectorVisible(true); setPanelWidth(25); }}>重置布局</button>
    </div>}
    <section aria-label={view.title} className="semantic-workspace">
    {!!layout.left?.length && activityVisible && <WorkspaceDivider side="left" width={panelWidth} change={setPanelWidth} />}
    {!!layout.right?.length && inspectorVisible && <WorkspaceDivider side="right" width={panelWidth} change={setPanelWidth} />}
    {!!layout.left?.length && <div className="semantic-activity" hidden={!activityVisible} style={{ flex: `0 0 ${panelWidth}%` }}>{layout.left.map(render)}</div>}
    <div className="semantic-main">
      {layout.main.some((s) => s.role === "summary") && <div className="semantic-summary">{layout.main.filter((s) => s.role === "summary").map(render)}</div>}
      {layout.main.filter((s) => s.role !== "summary").map(render)}
    </div>
    {!!layout.right?.length && <div className="semantic-inspector" hidden={!inspectorVisible} style={{ flex: `0 0 ${panelWidth}%` }}>{layout.right.map(render)}</div>}
  </section></>;
}
