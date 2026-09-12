import { useRef, useState, useEffect, type ReactNode } from "react";
export function RiskAction({ title, target, action, children }: { title: string; target?: string; action: (value: any) => void; children: (invoke: (value: any) => void) => ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<any>();
  useEffect(() => { if (pending) dialog.current?.showModal(); else dialog.current?.close(); }, [pending]);
  return <div className="dangerous-action"><p className="risk-warning">高风险操作 · 执行前请确认影响范围</p>{children(setPending)}
    <dialog className="application-detail" ref={dialog} onClose={() => setPending(undefined)} aria-label="确认高风险操作">
      <h2>{title}</h2><p>此操作可能产生难以恢复的影响。确认后仍需由服务端验证权限和审批状态。</p>
      {target && <p>目标：{target}</p>}
      <button autoFocus onClick={() => setPending(undefined)}>返回检查</button>
      <button onClick={() => { const value = pending; setPending(undefined); if (value) action(value); }}>确认执行</button>
    </dialog>
  </div>;
}
