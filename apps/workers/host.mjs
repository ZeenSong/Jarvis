import http from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";

// This process owns the normalized journal and survives a model process exit until archival.
mkdirSync("/workspace", { recursive: true });
const journal = "/workspace/events.ndjson";
let events = [];
try {
  events = readFileSync(journal, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let done = events.some((e) =>
  ["agent.run.completed", "agent.run.failed", "agent.run.cancelled"].includes(
    e.type,
  ),
);
let cancelling = false;
const requests = new Map();
const allowed = new Set([
  "agent.run.started",
  "agent.thinking",
  "agent.message.delta",
  "agent.tool.started",
  "agent.tool.completed",
  "agent.tool.failed",
  "agent.progress",
  "agent.waiting_user",
  "agent.approval.required",
  "agent.usage.updated",
  "agent.run.completed",
  "agent.run.failed",
  "agent.run.cancelled",
]);
function emit(event) {
  if (done || !allowed.has(event.type)) return;
  const row = { ...event, sequence: events.length + 1 };
  const encoded = JSON.stringify(row);
  if (encoded.length > 8 * 1024 * 1024) throw Error("event_too_large");
  appendFileSync(journal, encoded + "\n");
  events.push(row);
  process.stdout.write(encoded + "\n");
  if (
    ["agent.run.completed", "agent.run.failed", "agent.run.cancelled"].includes(
      row.type,
    )
  )
    done = true;
}
const coding = process.env.WORKER_TYPE === "codex";
const childEnv = { ...process.env };
delete childEnv.WORKER_TOKEN;
const child = done
  ? null
  : spawn(
      coding ? "node" : "python",
      [coding ? "/app/codex.mjs" : "/app/ops.py"],
      { env: childEnv, stdio: ["pipe", "pipe", "pipe"] },
    );
if (child) {
  child.stderr.on("data", () => {});
  child.on("error", () =>
    emit({
      type: "agent.run.failed",
      payload: { code: "worker_launch_failed" },
    }),
  );
  child.on("exit", () => {
    if (!done)
      emit({
        type: cancelling ? "agent.run.cancelled" : "agent.run.failed",
        payload: {
          code: cancelling ? "cancelled" : "worker_process_exited",
          summary: events
            .filter((e) => e.type === "agent.message.delta")
            .map((e) => e.payload.delta ?? "")
            .join(""),
        },
      });
    for (const p of requests.values()) p.reject(Error("worker_process_exited"));
    requests.clear();
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const row = JSON.parse(line);
      if (row.control_id) {
        const p = requests.get(row.control_id);
        if (p) {
          requests.delete(row.control_id);
          row.error ? p.reject(Error(row.error)) : p.resolve(row.result);
        }
        return;
      }
      if (!allowed.has(row.type)) throw Error("unknown_worker_event");
      emit(row);
    } catch {
      emit({
        type: "agent.run.failed",
        payload: { code: "worker_protocol_error" },
      });
      child.kill("SIGTERM");
    }
  });
}
function control(method, input) {
  return new Promise((resolve, reject) => {
    if (done) {
      reject(Error("worker_finished"));
      return;
    }
    if (!coding) {
      reject(Error("ops_does_not_wait_for_input"));
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(Error("worker_control_timeout"));
    }, 15000);
    requests.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    child.stdin.write(JSON.stringify({ id, method, input }) + "\n");
  });
}
const server = http.createServer(async (req, res) => {
  const actual = Buffer.from(req.headers.authorization ?? ""),
    expected = Buffer.from("Bearer " + (process.env.WORKER_TOKEN ?? ""));
  res.setHeader("content-type", "application/json");
  if (
    !process.env.WORKER_TOKEN ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    res.writeHead(401).end("{}");
    return;
  }
  try {
    const url = new URL(req.url, "http://worker");
    if (req.method === "GET" && url.pathname === "/events") {
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      if (!Number.isSafeInteger(cursor) || cursor < 0)
        throw Error("invalid_cursor");
      res.end(
        JSON.stringify({
          events: events.slice(cursor, cursor + 200),
          done: done && cursor + 200 >= events.length,
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      res.end(JSON.stringify({ healthy: true, done }));
      return;
    }
    if (
      req.method !== "POST" ||
      !["/send", "/resume", "/cancel", "/dispose"].includes(url.pathname)
    ) {
      res.writeHead(404).end("{}");
      return;
    }
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 65536) throw Error("input_too_large");
    }
    const p = JSON.parse(data || "{}");
    if (url.pathname === "/cancel") {
      cancelling = true;
      if (!done) child?.kill("SIGTERM");
      res.end('{"accepted":true}');
      return;
    }
    if (url.pathname === "/dispose") {
      if (!done) throw Error("archive_not_ready");
      res.end('{"disposed":true}');
      server.close(() => process.exit(0));
      return;
    }
    if (url.pathname === "/resume" && !p.text) {
      res.end(JSON.stringify({ healthy: true, done }));
      return;
    }
    if (typeof p.text !== "string" || p.text.length > 16000)
      throw Error("invalid_input");
    res.end(JSON.stringify(await control(url.pathname.slice(1), p)));
  } catch (e) {
    res.writeHead(409).end(JSON.stringify({ error: e.message }));
  }
});
server.listen(8091, "0.0.0.0");
const deadline = setTimeout(
  () => {
    if (!done) {
      child?.kill("SIGTERM");
      setTimeout(() => {
        if (!done) {
          emit({
            type: "agent.run.failed",
            payload: { code: "worker_timeout" },
          });
          child?.kill("SIGKILL");
        }
      }, 15000).unref();
    }
  },
  Number(process.env.WORKER_TIMEOUT_MS ?? (coding ? 1800000 : 300000)),
);
deadline.unref();
process.on("SIGTERM", () => {
  child?.kill("SIGTERM");
  setTimeout(() => process.exit(0), 18000).unref();
});
