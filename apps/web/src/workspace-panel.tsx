import { Blocks } from "./blocks";
import { viewSchema } from "../../../packages/ui-protocol/src/index";
import React, { useEffect, useState } from "react";
import { sandboxDocument } from "../../../packages/workspace-artifact/src/index";
import { viewSpecSchema } from "../../../packages/ui-protocol-v2/src/index";
import { DynamicView } from "./dynamic-v2";

export function WorkspacePanel({ gateway, conversationId, workspaceId, fallbackView, onError, developer = false, action = () => {} }: {
  gateway: { request: (topic: string, payload?: unknown) => Promise<any>; subscribe?: (topic: string, fn: (value: any) => void) => () => void };
  conversationId?: string;
  workspaceId?: string;
  fallbackView?: any;
  onError: (e: unknown) => void;
  developer?: boolean;
  action?: (value: any) => void;
}) {
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>();
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [nativeResources, setNativeResources] = useState<Map<string, any>>(new Map());
  const selectWorkspace = (current: any) => {
    setSelected(current);
    setSource(current?.artifacts?.[0]?.source ?? "");
  };
  const load = async (keepWorkspaceId = workspaceId ?? selected?.workspace?.id) => {
    if (!conversationId) return;
    const rows = await gateway.request("workspace.list", { conversation_id: conversationId });
    setWorkspaces(rows);
    if (keepWorkspaceId) {
      const current = await gateway.request("workspace.get", { workspace_id: keepWorkspaceId });
      selectWorkspace(current);
    } else if (rows[0]) {
      const current = await gateway.request("workspace.get", { workspace_id: rows[0].id });
      selectWorkspace(current);
    } else {
      setSelected(undefined);
      setSource("");
    }
  };
  useEffect(() => { void load().catch(onError); }, [conversationId, workspaceId]);
  useEffect(() => {
    const off = gateway.subscribe?.("workspace.artifact.updated", (event) => {
      if (event.workspace_id === (workspaceId ?? selected?.workspace?.id)) void load(event.workspace_id).catch(onError);
    });
    const offResources = gateway.subscribe?.("resource.updated", (resource) => setNativeResources((old) => new Map(old).set(resource.resource, resource)));
    return () => { off?.(); offResources?.(); };
  }, [gateway, workspaceId, selected?.workspace?.id, conversationId]);
  const create = async () => {
    if (!conversationId) return;
    setBusy(true);
    try {
      const value = await gateway.request("workspace.create", { conversation_id: conversationId, type: "native", title: "Jarvis 工作区" });
      const workspaceId = value.workspace?.id ?? value.id;
      const current = await gateway.request("workspace.get", { workspace_id: workspaceId });
      selectWorkspace(current);
      setWorkspaces((old) => [current.workspace, ...old.filter((item) => item.id !== workspaceId)]);
    } catch (e) { onError(e); } finally { setBusy(false); }
  };
  const saveArtifact = async () => {
    if (!selected?.workspace?.id || !source.trim()) return;
    setBusy(true);
    try {
      await gateway.request("workspace.artifact.upsert", { workspace_id: selected.workspace.id, artifact_id: artifact?.id, type: "html", media_type: "text/html", source, compiled: source, status: "ready" });
      setSelected(await gateway.request("workspace.get", { workspace_id: selected.workspace.id }));
      await load(selected.workspace.id);
    } catch (e) { onError(e); } finally { setBusy(false); }
  };
  const artifact = selected?.artifacts?.[0];
  let nativeView: any;
  let semanticView: any;
  try { if (artifact?.type === "native") {
    const value = JSON.parse(artifact.source);
    if (value.ui_protocol === "2.0") semanticView = viewSpecSchema.parse(value);
    else nativeView = viewSchema.parse(value);
  } } catch { /* fallback remains visible */ }
  useEffect(() => {
    let active = true;
    setNativeResources(new Map());
    if (artifact?.type === "native") {
      try {
        const value = JSON.parse(artifact.source);
        const sources = value.ui_protocol === "2.0" ? viewSpecSchema.parse(value).sections.flatMap((section) => section.source ? [section.source] : []) : viewSchema.parse(value).blocks.flatMap((block) => block.resource ? [block.resource] : []);
        for (const resource of new Set(sources)) void gateway.request("resource.get", { resource }).then((value) => {
          if (active) setNativeResources((old) => new Map(old).set(resource, value));
        }).catch(onError);
      } catch { onError(Error("工作区视图格式无效")); }
    }
    return () => { active = false; };
  }, [artifact?.id, artifact?.revision]);
  return <section className="workspace-panel" aria-label="持久化工作区">
    <div className="workspace-panel-header"><div><p className="eyebrow">当前对话的分析结果</p><h2>{selected?.workspace?.title ?? "正在整理结果"}</h2></div>{developer && <div className="workspace-panel-actions"><button onClick={() => void create()} disabled={!conversationId || busy}>＋ 新建</button>{selected && artifact?.type !== "native" && <button onClick={() => void saveArtifact()} disabled={busy || !source.trim()}>保存 Artifact</button>}</div>}</div>
    {!conversationId && <p className="muted">从一条对话打开工作区后，这里会保存可恢复的工作对象。</p>}
    {conversationId && developer && <div className="workspace-picker">{workspaces.map((w) => <button key={w.id} className={selected?.workspace?.id === w.id ? "selected" : ""} onClick={() => gateway.request("workspace.get", { workspace_id: w.id }).then(selectWorkspace).catch(onError)}>{w.title} · r{w.revision}</button>)}</div>}
    {nativeView && <Blocks view={nativeView} resources={nativeResources} action={action} />}
    {semanticView && <DynamicView value={semanticView} host="workspace" liveResources={nativeResources} action={action} />}
    {!artifact && !fallbackView && <section className="section-skeleton" role="status" aria-label="正在生成分析界面"><span /><span /><span /></section>}
    {selected && artifact?.type !== "native" && <>
      {developer && <label className="workspace-source">Artifact 源码<textarea value={source} onChange={(e) => setSource(e.target.value)} placeholder="输入 HTML/CSS/JS Artifact…" /></label>}
      {artifact?.compiled && <iframe className="workspace-artifact" title="沙箱 Artifact" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={sandboxDocument(artifact.compiled)} />}
    </>}
    {!selected && fallbackView && <div className="workspace-legacy">{fallbackView}</div>}
  </section>;
}
