import { useEffect, useState } from "react";
import { DynamicView } from "./dynamic-v2";
import type { Gateway } from "./gateway";
import type { Resource } from "../../../packages/ui-protocol/src/index";
import type { ConversationResult } from "../../../packages/conversation/src/results";

export function ResultHost({ result, gateway, openWorkspace, action, followup }: { result: ConversationResult; gateway: Gateway; openWorkspace?: (id: string, conversationId?: string) => void; action: (value: any) => void; followup?: (text: string) => void }) {
  const [resources, setResources] = useState(new Map<string, Resource>());
  useEffect(() => {
    let active = true;
    const sources = new Set(result.view?.sections.flatMap((section) => section.source ? [section.source] : []));
    const accept = (resource: Resource) => { if (active && sources.has(resource.resource)) setResources((old) => new Map(old).set(resource.resource, resource)); };
    if (result.target === "inline") for (const source of sources) void gateway.resource(source).then(accept).catch(() => { /* View keeps its persisted data or fallback. */ });
    const off = gateway.subscribe<Resource>("resource.updated", accept);
    return () => { active = false; off(); };
  }, [gateway, result.id, result.revision, result.target]);
  if (result.status === "failed") return <section className="result-error" role="status"><strong>{result.title}</strong><p>{result.error}</p></section>;
  if (result.target === "workspace") return <button className="result-workspace-link" onClick={() => result.workspace_id && openWorkspace?.(result.workspace_id, result.conversation_id)}><span>▥</span><span><strong>{result.title}</strong><small>{result.status === "loading" ? "正在生成分析界面" : "在工作区查看完整分析"}</small></span><span>↗</span></button>;
  if (!result.view) return <section className="section-skeleton" role="status"><h3>{result.title}</h3><span /><span /><span /></section>;
  return <DynamicView value={result.view} host="inline" liveResources={resources} action={action} followup={followup} />;
}
