import React, { useEffect, useState } from "react";
import { sandboxDocument } from "../../../packages/workspace-artifact/src/index";

export function WorkspacePanel({ gateway, conversationId, workspaceId, fallbackView, onError }: {
  gateway: { request: (topic: string, payload?: unknown) => Promise<any> };
  conversationId?: string;
  workspaceId?: string;
  fallbackView?: any;
  onError: (e: unknown) => void;
}) {
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>();
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
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
  return <section className="workspace-panel" aria-label="持久化工作区">
    <div className="workspace-panel-header"><div><p className="eyebrow">WORKSPACE</p><h2>{selected?.workspace?.title ?? "持续工作区"}</h2></div><div className="workspace-panel-actions"><button onClick={() => void create()} disabled={!conversationId || busy}>＋ 新建</button>{selected && <button onClick={() => void saveArtifact()} disabled={busy || !source.trim()}>保存 Artifact</button>}</div></div>
    {!conversationId && <p className="muted">从一条对话打开工作区后，这里会保存可恢复的工作对象。</p>}
    {conversationId && <div className="workspace-picker">{workspaces.map((w) => <button key={w.id} className={selected?.workspace?.id === w.id ? "selected" : ""} onClick={() => gateway.request("workspace.get", { workspace_id: w.id }).then(selectWorkspace).catch(onError)}>{w.title} · r{w.revision}</button>)}</div>}
    {selected && <>
      <label className="workspace-source">Artifact 源码<textarea value={source} onChange={(e) => setSource(e.target.value)} placeholder="输入 HTML/CSS/JS Artifact…" /></label>
      {artifact?.compiled && <iframe className="workspace-artifact" title="沙箱 Artifact" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={sandboxDocument(artifact.compiled)} />}
    </>}
    {!selected && fallbackView && <div className="workspace-legacy">{fallbackView}</div>}
  </section>;
}
