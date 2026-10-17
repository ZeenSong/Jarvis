import { AppearanceSettings, type JarvisStyle } from "./appearance";
import { FamilyServices } from "./family-services";
import { UserManagement } from "./user-management";

type SettingsPageProps = {
  gateway: { request: (topic: string, payload?: unknown) => Promise<any> };
  onError: (error: unknown) => void;
  style: JarvisStyle;
  onStyleChange: (style: JarvisStyle) => void;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  /** Developer surfaces (System, Hermes) are a preference, not a URL secret. */
  developer: boolean;
  onDeveloperChange: (value: boolean) => void;
};

export function SettingsPage({ gateway, onError, style, onStyleChange, theme, onThemeChange, developer, onDeveloperChange }: SettingsPageProps) {
  return <div className="settings-page">
    <p className="settings-lead">管理外观、家庭服务连接、账户信息和登录会话。</p>
    <AppearanceSettings style={style} onStyleChange={onStyleChange} theme={theme} onThemeChange={onThemeChange} />
    <FamilyServices gateway={gateway} onError={onError} />
    <UserManagement onError={onError} />
    <section className="settings-developer">
      <header className="section-head">
        <h2>开发者</h2>
        <span className="muted">面向诊断与集成调试</span>
      </header>
      <label className="developer-toggle">
        <input type="checkbox" checked={developer} onChange={(event) => onDeveloperChange(event.target.checked)} />
        <span>
          <strong>显示开发者入口</strong>
          <span className="muted">在侧栏显示「系统」与「Hermes」，并在执行过程中展示原始工具参数与结果。</span>
        </span>
      </label>
    </section>
  </div>;
}
