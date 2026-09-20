import { useCallback, useEffect, useState } from "react";

type ControlPlanePanelProps = {
  gateway: { request: (topic: string, payload?: unknown) => Promise<any>; addEventListener: (name: string, listener: EventListener) => void; removeEventListener: (name: string, listener: EventListener) => void };
  onError: (error: unknown) => void;
};

export function ControlPlanePanel({ gateway, onError }: ControlPlanePanelProps) {
  const [open, setOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<string>();
  const [approvals, setApprovals] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [role, setRole] = useState<string>();
  const [sessions, setSessions] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedulePrompt, setSchedulePrompt] = useState("");
  const [scheduleCadence, setScheduleCadence] = useState<"once" | "daily" | "weekly">("once");
  const [scheduleDate, setScheduleDate] = useState(() => { const date = new Date(Date.now() + 3600000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const refresh = useCallback(async () => {
    const [nextApprovals, nextNotifications, nextSchedules] = await Promise.all([gateway.request("approval.list"), gateway.request("notification.list"), gateway.request("schedule.list")]);
    setApprovals(nextApprovals); setNotifications(nextNotifications); setSchedules(nextSchedules);
  }, [gateway]);
  useEffect(() => { if (open) void refresh().catch(onError); }, [open, refresh, onError]);
  useEffect(() => {
    if (!open) return;
    void fetch("/api/v2/auth/me", { credentials: "include" }).then(async (response) => {
      if (response.ok) { const value = await response.json(); setRole(value.user?.role); setSessions(value.sessions ?? []); }
    }).catch(onError);
  }, [open, onError]);
  useEffect(() => {
    const update = () => void refresh().catch(onError);
    gateway.addEventListener("approval.created", update); gateway.addEventListener("approval.resolved", update); gateway.addEventListener("notification.created", update);
    return () => { gateway.removeEventListener("approval.created", update); gateway.removeEventListener("approval.resolved", update); gateway.removeEventListener("notification.created", update); };
  }, [gateway, refresh, onError]);
  const pending = approvals.filter((item) => item.status === "pending").length;
  const unread = notifications.filter((item) => !item.read_at && item.kind !== "approval").length;
  const createSchedule = async () => {
    const next = new Date(scheduleDate);
    if (Number.isNaN(next.getTime())) { onError(Error("请选择有效的首次执行时间")); return; }
    await gateway.request("schedule.create", { prompt: schedulePrompt.trim(), cadence: scheduleCadence, next_run_at: next.toISOString() });
    setSchedulePrompt(""); await refresh();
  };
  return <div className="control-plane">
    <button className="quiet control-plane-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>待处理{pending + unread ? ` · ${pending + unread}` : ""}</button>
    {open && <section className="control-plane-popover" aria-label="待处理事项">
      <header><strong>控制面</strong><button className="quiet" onClick={() => void refresh().catch(onError)}>刷新</button></header>
      {pending > 0 && <div className="approval-list"><h3>需要审批</h3>{approvals.filter((item) => item.status === "pending").map((item) => <article key={item.id} className="approval-item"><div><strong>{item.capability}</strong><details><summary>查看执行参数</summary><pre>{JSON.stringify(item.input, null, 2)}</pre><p>有效期：{new Date(item.expires_at).toLocaleString()}</p></details><small>{item.run_id ? `任务 ${item.run_id.slice(0, 8)}` : "手动请求"}</small></div><div><button onClick={() => void gateway.request("approval.resolve", { approval_id: item.id, status: "approved" }).then(refresh).catch(onError)}>批准</button><button className="quiet" onClick={() => void gateway.request("approval.resolve", { approval_id: item.id, status: "rejected" }).then(refresh).catch(onError)}>拒绝</button></div></article>)}</div>}
      {role === "admin" && <form className="invite-form" onSubmit={(event) => { event.preventDefault(); void fetch("/api/v2/auth/invites", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: inviteUsername.trim() }) }).then(async (response) => { if (!response.ok) throw Error("邀请创建失败"); const value = await response.json(); setInviteToken(value.token); setInviteUsername(""); }).catch(onError); }}><h3>邀请成员</h3><div><input aria-label="成员用户名" placeholder="成员用户名" value={inviteUsername} onChange={(event) => setInviteUsername(event.target.value)} minLength={3} maxLength={80} /><button disabled={inviteUsername.trim().length < 3}>创建邀请</button></div>{inviteToken && <p className="invite-token">一次性邀请令牌：<code>{inviteToken}</code></p>}</form>}
      {sessions.length > 0 && <div className="session-list"><h3>已登录设备</h3>{sessions.map((session) => <div className="session-item" key={session.id}><span>{session.device_id ?? "浏览器"}<small>{session.last_seen_at ? new Date(session.last_seen_at).toLocaleString() : ""}</small></span><button className="quiet" onClick={() => void fetch(`/api/v2/auth/sessions/${session.id}`, { method: "DELETE", credentials: "include" }).then((response) => { if (!response.ok) throw Error("会话撤销失败"); setSessions((current) => current.filter((item) => item.id !== session.id)); }).catch(onError)}>撤销</button></div>)}</div>}
      <form className="schedule-form" onSubmit={(event) => { event.preventDefault(); void createSchedule().catch(onError); }}><h3>定时任务</h3><input aria-label="定时任务内容" placeholder="例如：每天早上汇总服务器状态" value={schedulePrompt} onChange={(event) => setSchedulePrompt(event.target.value)} /><div><select aria-label="定时任务频率" value={scheduleCadence} onChange={(event) => setScheduleCadence(event.target.value as typeof scheduleCadence)}><option value="once">一次</option><option value="daily">每天</option><option value="weekly">每周</option></select><input aria-label="首次执行时间" type="datetime-local" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /><button disabled={!schedulePrompt.trim()}>添加</button></div>{schedules.slice(0, 8).map((schedule) => <div className="schedule-item" key={schedule.id}><span>{schedule.prompt}<small>{schedule.enabled ? "启用" : "已停用"} · {new Date(schedule.next_run_at).toLocaleString()}</small></span><button type="button" className="quiet" onClick={() => void gateway.request("schedule.toggle", { schedule_id: schedule.id, enabled: !schedule.enabled }).then(refresh).catch(onError)}>{schedule.enabled ? "停用" : "启用"}</button><button type="button" className="quiet" onClick={() => void gateway.request("schedule.delete", { schedule_id: schedule.id }).then(refresh).catch(onError)}>删除</button></div>)}</form>
      {selectedApproval && <section className="approval-detail" aria-label="审批详情"><h3>审批详情</h3>{(() => {
        const item = approvals.find((entry) => entry.id === selectedApproval);
        return item ? <><p>{item.capability} · {({ pending: "待审批", approved: "已批准", rejected: "已拒绝", expired: "已过期" } as Record<string,string>)[item.status]}</p><p>有效期：{new Date(item.expires_at).toLocaleString()}{item.consumed_at ? " · 已使用" : ""}</p><pre>{JSON.stringify(item.input, null, 2)}</pre></> : <p>该审批已不可用，请刷新查看当前状态。</p>;
      })()}<button onClick={() => setSelectedApproval(undefined)}>关闭详情</button></section>}
      <div className="notification-list"><h3>通知</h3>{notifications.length ? notifications.slice(0, 8).map((item) => <button className={item.read_at ? "notification read" : "notification"} key={item.id} onClick={() => { if (item.kind === "approval") setSelectedApproval(item.reference_id); else void gateway.request("notification.read", { notification_id: item.id }).then(refresh).catch(onError); }}><strong>{item.title}</strong><span>{item.body}</span></button>) : <p className="muted">暂无通知</p>}</div>
    </section>}
  </div>;
}
