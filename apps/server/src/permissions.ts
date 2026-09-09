import { m2Topics } from "./m2.js";
const common = [
  "gateway.ping",
  "gateway.subscribe",
  "system.status.get",
  "agent.list",
  "agent.get",
  "llm.usage.summary",
];
const reports = [
  "agent.register",
  "agent.heartbeat",
  "agent.task.started",
  "agent.task.finished",
  "agent.error",
  "llm.request.completed",
];
export function permitted(role: "device" | "agent", topic: string) {
  return role === "device"
    ? common.includes(topic) || (m2Topics as readonly string[]).includes(topic)
    : ["gateway.ping", "gateway.subscribe", ...reports].includes(topic);
}
