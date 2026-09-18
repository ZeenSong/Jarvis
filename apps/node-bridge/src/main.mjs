import { randomUUID } from "node:crypto";
import http from "node:http";
import os from "node:os";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";

const nodeId = process.env.NODE_ID ?? `ubuntu-${process.pid}`;
const gatewayUrl = process.env.JARVIS_GATEWAY_URL;
const token = process.env.NODE_TOKEN;
if (!gatewayUrl || !token) throw Error("JARVIS_GATEWAY_URL and NODE_TOKEN are required");
const supportedCapabilities = new Set(["node.system.read", "node.file.read", "node.git.read", ...(process.env.NODE_CODEX_BIN ? ["node.codex.execute"] : [])]);
const defaultCapabilities = ["node.system.read", "node.file.read", "node.git.read", ...(process.env.NODE_CODEX_BIN ? ["node.codex.execute"] : [])];
const capabilities = (process.env.NODE_CAPABILITIES ?? defaultCapabilities.join(","))
  .split(",").map((name) => name.trim()).filter((name) => supportedCapabilities.has(name))
  .map((name) => ({ name, version: "1.0", risk: name === "node.codex.execute" ? "execute" : "read", available: true }));
let socket; let sequence = 0;
async function executeCapability(capability, input = {}) {
  if (capability === "node.system.read") return { hostname: os.hostname(), platform: process.platform, arch: process.arch, cpus: os.cpus().length, uptime_seconds: os.uptime(), memory: { total: os.totalmem(), free: os.freemem() } };
  if (capability === "node.file.read") {
    const root = await realpath(process.env.NODE_ALLOWED_ROOT ?? process.cwd());
    const target = await realpath(path.resolve(root, String(input.path ?? "")));
    if (target !== root && !target.startsWith(root + path.sep)) throw Error("path_outside_allowed_root");
    return { path: target.slice(root.length + 1), content: (await readFile(target, "utf8")).slice(0, 1_000_000) };
  }
  if (capability === "node.git.read") {
    const root = await realpath(process.env.NODE_ALLOWED_ROOT ?? process.cwd());
    const cwd = await realpath(path.resolve(root, String(input.path ?? "")));
    if (cwd !== root && !cwd.startsWith(root + path.sep)) throw Error("path_outside_allowed_root");
    return await runProcess("git", ["-C", cwd, "status", "--short", "--branch"], cwd, 15000);
  }
  if (capability === "node.codex.execute") {
    if (!process.env.NODE_CODEX_BIN) throw Error("codex_not_configured");
    const root = await realpath(process.env.NODE_ALLOWED_ROOT ?? process.cwd());
    const cwd = await realpath(path.resolve(root, String(input.cwd ?? "")));
    if (cwd !== root && !cwd.startsWith(root + path.sep)) throw Error("path_outside_allowed_root");
    const prompt = String(input.prompt ?? "").trim();
    if (!prompt || prompt.length > 4000) throw Error("prompt_invalid");
    // The Kernel approval covers one bounded Codex run. The container is the
    // execution boundary: the project is mounted read-only and the prompt
    // cannot replace the executable, working root, or subcommand.
    return await runProcess(process.env.NODE_CODEX_BIN, ["exec", "--ephemeral", "--sandbox", "danger-full-access", "--cd", cwd, prompt], cwd, Math.min(300000, Math.max(1000, Number(input.timeout_ms ?? 120000))));
  }
  throw Error("capability_not_available");
}
function runProcess(command, args, cwd, timeout) {
  return new Promise((resolve, reject) => {
    const childEnv = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      ...Object.fromEntries(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NO_PROXY", "no_proxy"].filter((name) => process.env[name]).map((name) => [name, process.env[name]])),
    };
    const child = spawn(command, args, { cwd, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
    let stdout = "", stderr = "", tooLarge = false;
    const append = (target, chunk) => { if (target.length + chunk.length > 1_000_000) { tooLarge = true; return target; } return target + chunk; };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk.toString()); }); child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk.toString()); });
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } reject(Error("process_timeout")); }, timeout);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); if (tooLarge) reject(Error("process_output_too_large")); else resolve({ exit_code: code, signal, stdout, stderr }); });
  });
}
const send = (topic, payload) => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ id: randomUUID(), version: 1, type: "event", topic, payload }));
function connect() {
  socket = new WebSocket(gatewayUrl.replace(/^http/, "ws") + "/ws", { headers: { Authorization: `Bearer ${token}` } });
  socket.on("open", () => { send("agent.register", { agent_id: nodeId, name: process.env.NODE_NAME ?? nodeId, runtime: "node-bridge", version: "1.0", capabilities: capabilities.map((c) => c.name) }); sendHeartbeat(); });
  socket.on("message", async (raw) => {
    let request;
    try { request = JSON.parse(raw.toString()); } catch { return; }
    if (request.type !== "request" || request.topic !== "node.invoke" || !request.id) return;
    try {
      const result = await executeCapability(String(request.payload?.capability), request.payload?.input ?? {});
      socket?.send(JSON.stringify({ id: randomUUID(), version: 1, type: "response", topic: "node.invoke", reply_to: request.id, timestamp: new Date().toISOString(), payload: { ok: true, result } }));
    } catch (error) {
      socket?.send(JSON.stringify({ id: randomUUID(), version: 1, type: "error", topic: "node.invoke", reply_to: request.id, timestamp: new Date().toISOString(), payload: { error: error instanceof Error ? error.message : "execution_failed" } }));
    }
  });
  socket.on("close", () => setTimeout(connect, 1000));
  socket.on("error", () => socket.close());
}
function sendHeartbeat() { if (!socket || socket.readyState !== WebSocket.OPEN) return; send("agent.heartbeat", { agent_id: nodeId, status: "idle", provider: null, model: null, task_id: null, sequence: ++sequence }); }
setInterval(sendHeartbeat, 15000).unref(); connect();
http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET" && req.url === "/health") return res.end(JSON.stringify({ healthy: true, node_id: nodeId, connected: socket?.readyState === WebSocket.OPEN }));
  if (req.method === "GET" && req.url === "/capabilities") return res.end(JSON.stringify({ node_id: nodeId, platform: process.platform, capabilities }));
  if (req.method === "POST" && req.url === "/execute") {
    if (!process.env.NODE_EXECUTION_KEY || req.headers.authorization !== `Bearer ${process.env.NODE_EXECUTION_KEY}`) { res.writeHead(401).end(JSON.stringify({ error: "unauthorized" })); return; }
    let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 65536) { res.writeHead(413).end(JSON.stringify({ error: "input_too_large" })); return; } }
    try {
      const input = JSON.parse(body); let result;
      result = await executeCapability(String(input.capability), input);
      return res.end(JSON.stringify({ ok: true, result }));
    } catch (e) { res.writeHead(400).end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "execution_failed" })); return; }
  }
  res.writeHead(404).end(JSON.stringify({ error: "not_found" }));
}).listen(Number(process.env.NODE_BRIDGE_PORT ?? 8790), "127.0.0.1");
