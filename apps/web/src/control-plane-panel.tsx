import { useCallback, useEffect, useState } from "react";

type ControlPlanePanelProps = {
  gateway: { request: (topic: string, payload?: unknown) => Promise<any>; addEventListener: (name: string, listener: EventListener) => void; removeEventListener: (name: string, listener: EventListener) => void };
  onError: (error: unknown) => void;
};

export function ControlPlanePanel({ gateway, onError }: ControlPlanePanelProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);

  const refresh = useCallback(async () => {
    setNotifications(await gateway.request("notification.list"));
  }, [gateway]);

  useEffect(() => {
    if (open) void refresh().catch(onError);
  }, [open, refresh, onError]);

  useEffect(() => {
    const update = () => { void refresh().catch(onError); };
    gateway.addEventListener("notification.created", update);
    const reconnect = (event: Event) => { if ((event as CustomEvent<string>).detail === "已连接") void refresh().catch(onError); };
    gateway.addEventListener("connection", reconnect);
    return () => { gateway.removeEventListener("notification.created", update); gateway.removeEventListener("connection", reconnect); };
  }, [gateway, open, refresh, onError]);

  const unread = notifications.filter((item) => !item.read_at).length;
  const markRead = (id: string) => void gateway.request("notification.read", { notification_id: id }).then(refresh).catch(onError);

  return <div className="control-plane">
    <button className="quiet control-plane-toggle" aria-label="打开通知" aria-expanded={open} onClick={() => setOpen((value) => !value)}>通知{unread ? ` · ${unread}` : ""}</button>
    {open && <section className="control-plane-popover notification-popover" aria-label="通知">
      <header><strong>通知</strong><button className="quiet" onClick={() => void refresh().catch(onError)}>刷新</button></header>
      <div className="notification-list">{notifications.length ? notifications.slice(0, 12).map((item) => <button className={item.read_at ? "notification read" : "notification"} key={item.id} onClick={() => markRead(item.id)}><strong>{item.title}</strong><span>{item.body}</span><small>{item.created_at ? new Date(item.created_at).toLocaleString() : ""}</small></button>) : <p className="muted">暂无通知</p>}</div>
    </section>}
  </div>;
}
