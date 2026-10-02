import { useCallback, useEffect, useState, type FormEvent } from "react";

type UserManagementProps = {
  onError: (error: unknown) => void;
};

type JarvisUser = {
  id: string;
  username: string;
  role: "admin" | "member";
  created_at: string;
  active_sessions: number;
};

const capabilityLabels: Array<[string, string]> = [
  ["mcp.homeassistant.read", "Home Assistant 读取"],
  ["mcp.homeassistant.write", "Home Assistant 控制"],
  ["mcp.immich.read", "Immich 读取"],
  ["mcp.immich.write", "Immich 修改"],
  ["schedule.write", "定时任务"],
];

export function UserManagement({ onError }: UserManagementProps) {
  const [me, setMe] = useState<any>();
  const [users, setUsers] = useState<JarvisUser[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [capabilities, setCapabilities] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const meResponse = await fetch("/api/v2/auth/me", { credentials: "include" });
      if (!meResponse.ok) throw Error("当前登录已失效，请重新登录");
      const current = await meResponse.json();
      setMe(current);
      setSessions(current.sessions ?? []);
      if (current.user?.role === "admin") {
        const usersResponse = await fetch("/api/v2/auth/users", { credentials: "include" });
        if (!usersResponse.ok) throw Error("无法读取用户列表");
        const listed = await usersResponse.json() as JarvisUser[];
        setUsers(listed);
        const policies = await Promise.all(listed.map(async (user) => {
          const response = await fetch(`/api/v2/auth/users/${user.id}/capabilities`, { credentials: "include" });
          return [user.id, response.ok ? ((await response.json()).capabilities ?? []) : []] as const;
        }));
        setCapabilities(Object.fromEntries(policies));
      }
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createInvite = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch("/api/v2/auth/invites", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: inviteUsername.trim() }),
    });
    if (!response.ok) throw Error("邀请创建失败，请确认用户名未被占用");
    const value = await response.json();
    setInviteToken(value.token);
    setInviteUsername("");
    await refresh();
  };

  const changeCapability = async (user: JarvisUser, capability: string, allowed: boolean) => {
    const response = await fetch(`/api/v2/auth/users/${user.id}/capabilities`, {
      method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability, allowed }),
    });
    if (!response.ok) throw Error("成员能力更新失败");
    setCapabilities((current) => ({ ...current, [user.id]: (current[user.id] ?? []).filter((item) => item !== capability).concat(allowed ? [capability] : []) }));
  };

  const changeRole = async (user: JarvisUser, role: "admin" | "member") => {
    const response = await fetch(`/api/v2/auth/users/${user.id}`, {
      method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw Error(value.error === "last_admin" ? "至少要保留一名管理员" : value.error === "cannot_change_own_role" ? "不能修改自己的管理员身份" : "用户角色更新失败");
    }
    await refresh();
  };

  const revokeSession = async (id: string) => {
    const response = await fetch(`/api/v2/auth/sessions/${id}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) throw Error("会话撤销失败");
    await refresh();
  };

  if (loading && !me) return <p className="muted">正在读取用户管理…</p>;
  if (!me) return null;
  const isAdmin = me.user?.role === "admin";

  return <div className="user-management">
    <section className="user-hero">
      <p className="eyebrow">ACCOUNT / USERS</p>
      <h2>用户管理</h2>
      <p className="muted">当前登录：<strong>{me.user?.username}</strong> · {isAdmin ? "管理员" : "成员"}</p>
    </section>

    {isAdmin ? <>
      <section className="block">
        <div className="section-heading"><h2>Jarvis 用户</h2><button className="quiet" onClick={() => void refresh()}>刷新</button></div>
        <p className="muted">第一个注册账户自动成为管理员。管理员可以邀请成员、调整角色，并撤销其他设备的登录会话。</p>
        <div className="user-list">{users.map((user) => <article className="user-row" key={user.id}>
          <div><strong>{user.username}</strong><small>{user.role === "admin" ? "管理员" : "成员"} · {user.active_sessions} 个活跃会话 · 注册于 {new Date(user.created_at).toLocaleDateString()}</small></div>
          <select aria-label={`${user.username} 的角色`} value={user.role} disabled={user.id === me.user?.id} onChange={(event) => void changeRole(user, event.target.value as "admin" | "member").catch(onError)}>
            <option value="member">成员</option><option value="admin">管理员</option>
          </select>
          {user.role === "member" && <div className="user-capabilities" aria-label={`${user.username} 的能力`}>
            {capabilityLabels.map(([capability, label]) => <label key={capability}><input type="checkbox" checked={(capabilities[user.id] ?? []).includes(capability)} onChange={(event) => void changeCapability(user, capability, event.target.checked).catch(onError)} />{label}</label>)}
          </div>}
        </article>)}</div>
      </section>
      <section className="block">
        <h2>邀请成员</h2>
        <p className="muted">输入成员用户名后生成一次性邀请令牌。成员用令牌设置自己的 Jarvis 密码，之后只用用户名和密码登录。</p>
        <form className="invite-form" onSubmit={(event) => { void createInvite(event).catch(onError); }}>
          <div><input aria-label="成员用户名" placeholder="成员用户名" value={inviteUsername} onChange={(event) => setInviteUsername(event.target.value)} minLength={3} maxLength={80} /><button disabled={inviteUsername.trim().length < 3}>创建邀请</button></div>
          {inviteToken && <p className="invite-token">请安全地把令牌发给成员：<code>{inviteToken}</code></p>}
        </form>
      </section>
    </> : <section className="block"><h2>账户说明</h2><p className="muted">你的账户由 Jarvis 管理员维护。如需新增成员或调整权限，请联系管理员。</p></section>}

    <section className="block">
      <h2>登录会话</h2>
      <p className="muted">可以随时撤销其他设备的登录；退出当前账户会立即回到登录页。</p>
      <div className="session-list">{sessions.map((session) => <div className="session-item" key={session.id}>
        <span>{session.id === me.session_id ? "当前浏览器" : "其他设备"}<small>{session.last_seen_at ? `最近活动：${new Date(session.last_seen_at).toLocaleString()}` : ""}</small></span>
        {session.id === me.session_id ? <strong>当前</strong> : <button className="quiet" onClick={() => void revokeSession(session.id).catch(onError)}>撤销</button>}
      </div>)}</div>
    </section>
  </div>;
}
