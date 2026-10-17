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
};

export function SettingsPage({ gateway, onError, style, onStyleChange, theme, onThemeChange }: SettingsPageProps) {
  return <div className="settings-page">
    <p className="settings-lead">管理外观、家庭服务连接、账户信息和登录会话。</p>
    <AppearanceSettings style={style} onStyleChange={onStyleChange} theme={theme} onThemeChange={onThemeChange} />
    <FamilyServices gateway={gateway} onError={onError} />
    <UserManagement onError={onError} />
  </div>;
}
