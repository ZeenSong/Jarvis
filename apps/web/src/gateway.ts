import {
  applyResource,
  type Resource,
} from "../../../packages/ui-protocol/src/index";
import { randomUUID } from "./uuid";
let refreshing: Promise<boolean> | undefined;
export async function ensureSession(): Promise<boolean> {
  const response = await fetch("/api/v2/session", { credentials: "include" });
  if (response.ok) return true;
  if (response.status !== 401) throw Error("暂时无法验证登录状态");
  if (!refreshing) refreshing = fetch("/api/v2/auth/refresh", { method: "POST", credentials: "include" })
    .then((result) => { if (result.ok) return true; if (result.status === 401) return false; throw Error("登录续期暂时失败"); })
    .finally(() => { refreshing = undefined; });
  return refreshing;
}
export class Gateway extends EventTarget {
  socket?: WebSocket;
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private retry = 0;
  private closed = false;
  resources = new Map<string, Resource>();
  async open(restart = false) {
    if (restart) this.closed = false;
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return;
    if (this.closed) return;
    this.dispatchEvent(new CustomEvent("connection", { detail: "连接中" }));
    try {
      if (!await ensureSession()) { this.dispatchEvent(new Event("auth-required")); return; }
    } catch {
      if (!this.closed) setTimeout(() => void this.open(), Math.min(30000, 1000 * 2 ** this.retry++));
      return;
    }
    if (this.closed) return;
    const socket = (this.socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    ));
    socket.onopen = () => {
      this.retry = 0;
      this.dispatchEvent(new CustomEvent("connection", { detail: "已连接" }));
      this.dispatchEvent(new Event("snapshot"));
    };
    socket.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.reply_to) {
          const p = this.pending.get(m.reply_to);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(m.reply_to);
            m.type === "error"
              ? p.reject(Error(`${topicLabel(m.topic)}：${errorLabel(m.payload.error)}`))
              : p.resolve(m.payload);
          }
          return;
        }
        if (m.topic === "resource.updated") this.accept(m.payload);
        this.dispatchEvent(new CustomEvent(m.topic, { detail: m.payload }));
      } catch {
        this.dispatchEvent(
          new CustomEvent("error", { detail: "无法解析服务器响应" }),
        );
      }
    };
    socket.onclose = (event) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error("连接中断，正在恢复"));
      }
      this.pending.clear();
      this.dispatchEvent(new CustomEvent("connection", { detail: "重新连接" }));
      if (event.code === 4001) { this.closed = true; this.resources.clear(); this.dispatchEvent(new Event("auth-required")); return; }
      if (!this.closed)
        setTimeout(
          () => this.open(),
          Math.min(30000, 1000 * 2 ** this.retry++) + Math.random() * 300,
        );
    };
  }
  accept(next: Resource) {
    const current = this.resources.get(next.resource);
    const value = applyResource(current, next);
    this.resources.set(next.resource, value);
    return value;
  }
  request(topic: string, payload: unknown = {}): Promise<any> {
    if (this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(Error("尚未连接"));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("请求超时"));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(
        JSON.stringify({ id, version: 1, type: "request", topic, payload }),
      );
    });
  }
  async resource(name: string) {
    return this.accept(await this.request("resource.get", { resource: name }));
  }
  close() {
    this.closed = true;
    this.socket?.close();
  }
}

function topicLabel(topic: string) { return topic.startsWith("view.") ? "视图加载失败" : topic === "resource.get" ? "数据加载失败" : "请求失败"; }
function errorLabel(code: string) { return ({ request_failed: "服务器暂时无法完成请求，请刷新重试", approval_required: "审批已失效、已使用或与本次操作不一致", validation_error: "请求格式不符合接口要求" } as Record<string,string>)[code] ?? code; }
