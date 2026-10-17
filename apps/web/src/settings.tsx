import { FamilyServices } from "./family-services";
import { UserManagement } from "./user-management";

type SettingsPageProps = {
  gateway: { request: (topic: string, payload?: unknown) => Promise<any> };
  onError: (error: unknown) => void;
};

export function SettingsPage({ gateway, onError }: SettingsPageProps) {
  return <div className="settings-page">
    <p className="settings-lead">管理家庭服务连接、账户信息和登录会话。</p>
    <FamilyServices gateway={gateway} onError={onError} />
    <UserManagement onError={onError} />
  </div>;
}
