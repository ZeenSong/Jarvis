import { useCallback, useEffect, useState, type FormEvent } from "react";

type FamilyServicesProps = {
  gateway: { request: (topic: string, payload?: unknown) => Promise<any> };
  onError: (error: unknown) => void;
};

type ProviderOption = { id: string; name: string; credentialProvider: string };

const defaultProviders: ProviderOption[] = [
  { id: "home-assistant", name: "Home Assistant", credentialProvider: "home-assistant" },
  { id: "immich", name: "Immich", credentialProvider: "immich" },
];

export function FamilyServices({ gateway, onError }: FamilyServicesProps) {
  const [credentials, setCredentials] = useState<any[]>([]);
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>(defaultProviders);
  const [credentialProvider, setCredentialProvider] = useState("home-assistant");
  const [credentialLabel, setCredentialLabel] = useState("");
  const [credentialSecret, setCredentialSecret] = useState("");
  const [credentialStatus, setCredentialStatus] = useState<Record<string, "testing" | "connected" | "failed">>({});
  const [credentialNotice, setCredentialNotice] = useState("");

  const refresh = useCallback(async () => {
    const [list, integrations] = await Promise.all([
      gateway.request("integration.credential.list"),
      gateway.request("integration.list").catch(() => ({ integrations: [] })),
    ]);
    setCredentials(list);
    setCredentialsLoaded(true);
    const discovered: ProviderOption[] = Array.isArray(integrations?.integrations)
      ? integrations.integrations
          .filter((item: any) => item?.id && item?.name)
          .map((item: any) => ({
            id: String(item.id),
            name: String(item.name),
            credentialProvider: String(item.credential_provider ?? item.id),
          }))
      : [];
    if (discovered.length) {
      // Key by the credential provider so the built-in Home Assistant alias
      // ("home-assistant") and the app id ("homeassistant") do not appear twice.
      const merged = new Map<string, ProviderOption>(defaultProviders.map((item) => [item.credentialProvider, item]));
      for (const item of discovered) merged.set(item.credentialProvider, item);
      const values = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
      setProviders(values);
      setCredentialProvider((current) => (values.some((item) => item.credentialProvider === current) ? current : values[0].credentialProvider));
    }
  }, [gateway]);

  useEffect(() => { void refresh().catch(onError); }, [refresh, onError]);

  const saveCredential = async (event: FormEvent) => {
    event.preventDefault();
    if (!credentialSecret.trim()) return;
    setCredentialNotice("已保存，正在验证连接…");
    const saved = await gateway.request("integration.credential.put", {
      provider: credentialProvider,
      label: credentialLabel.trim() || "Jarvis 服务连接",
      secret: credentialSecret,
      metadata: { source: "Jarvis 设置" },
    });
    setCredentialSecret("");
    setCredentialLabel("");
    const credentialId = String(saved.id);
    setCredentialStatus((current) => ({ ...current, [credentialId]: "testing" }));
    try {
      const response = await fetch(`/api/v2/integration/credentials/${encodeURIComponent(credentialId)}/test`, { method: "POST", credentials: "include" });
      const result = await response.json() as { connected?: boolean };
      if (!response.ok || result.connected !== true) {
        setCredentialStatus((current) => ({ ...current, [credentialId]: "failed" }));
        setCredentialNotice("已加密保存，但连接验证失败；请检查凭据和服务权限。");
      } else {
        setCredentialStatus((current) => ({ ...current, [credentialId]: "connected" }));
        setCredentialNotice("连接已验证，可以在 Jarvis 中使用。");
      }
    } catch {
      setCredentialStatus((current) => ({ ...current, [credentialId]: "failed" }));
      setCredentialNotice("已加密保存，但暂时无法验证服务连接。");
    }
    await refresh();
  };

  return <section className="block settings-section" aria-label="家庭服务链接">
    <div className="section-heading"><div><p className="eyebrow">INTEGRATIONS</p><h2>家庭服务链接</h2></div><button className="quiet" onClick={() => void refresh().catch(onError)}>刷新</button></div>
    <p className="muted">在对应服务中创建只读凭据，再粘贴到这里。Jarvis 只显示连接状态，不会回显秘密。应用页的「一键连接」会自动把这个应用加入下面的列表。</p>
    {credentialNotice && <p className="credential-notice" role="status">{credentialNotice}</p>}
    <form className="credential-form settings-credential-form" onSubmit={(event) => { void saveCredential(event).catch(onError); }}>
      <div><select aria-label="家庭服务" value={credentialProvider} onChange={(event) => setCredentialProvider(event.target.value)}>{providers.map((provider) => <option key={provider.credentialProvider} value={provider.credentialProvider}>{provider.name}</option>)}</select><input aria-label="连接标签" placeholder="连接标签（可选）" value={credentialLabel} onChange={(event) => setCredentialLabel(event.target.value)} maxLength={120} /></div>
      <input aria-label="服务凭据" type="password" autoComplete="new-password" placeholder="只读服务凭据（会话型应用填 用户名:密码）" value={credentialSecret} onChange={(event) => setCredentialSecret(event.target.value)} maxLength={16384} />
      <button disabled={!credentialSecret.trim()}>保存并验证</button>
    </form>
    {credentials.length ? <div className="credential-list">{credentials.map((item) => <div className="credential-item" key={item.id}><span><strong>{providers.find((provider) => provider.credentialProvider === item.provider)?.name ?? String(item.provider)}</strong><small>{item.label} · {credentialStatus[item.id] === "connected" ? "连接已验证" : credentialStatus[item.id] === "failed" ? "已保存，验证失败" : credentialStatus[item.id] === "testing" ? "正在验证连接…" : "已加密保存"}</small></span><button type="button" className="quiet" onClick={() => void gateway.request("integration.credential.revoke", { credential_id: item.id }).then(() => { setCredentialStatus((current) => { const next = { ...current }; delete next[item.id]; return next; }); return refresh(); }).catch(onError)}>撤销</button></div>)}</div> : <p className="muted">{credentialsLoaded ? "尚未配置家庭服务连接。" : "正在读取家庭服务连接…"}</p>}
  </section>;
}
