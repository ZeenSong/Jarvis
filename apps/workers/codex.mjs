// Runs only inside the fixed, unprivileged Job. No host checkout or global Codex config.
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, copyFile, chmod, writeFile } from "node:fs/promises";
import { persistLogin } from "./codex-auth.mjs";
const emit = (type, payload = {}) =>
  process.stdout.write(JSON.stringify({ type, payload }) + "\n");
const git = (args) =>
  execFileSync("git", args, {
    cwd: "/workspace/repo",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
let child,
  threadId,
  turnId,
  summary = "";
let question;
let lastUsage = {};
const pending = new Map();
let seq = 0;
let finished = false;
let authTimer;
let authWrite = Promise.resolve();
const saveLogin = () => {
  if (process.env.CODEX_AUTH_WRITEBACK !== "1") return Promise.resolve();
  authWrite = authWrite
    .catch(() => {})
    .then(() =>
      persistLogin("/workspace/codex/auth.json", "/credentials/auth.json"),
    );
  return authWrite;
};
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("codex_rpc_timeout"));
    }, 30000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
async function finish(status, error) {
  if (finished) return;
  finished = true;
  clearInterval(authTimer);
  try {
    await saveLogin();
  } catch {
    emit("agent.progress", {
      code: "codex_login_persist_failed",
      title: "登录续期保存失败，需检查凭据存储",
    });
  }
  try {
    const diff = git(["diff", "--binary", "HEAD"]);
    const changed_files = git(["status", "--short"]);
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean);
    let added = "";
    for (const path of untracked) {
      try {
        added += execFileSync(
          "git",
          ["diff", "--no-index", "--binary", "--", "/dev/null", path],
          {
            cwd: "/workspace/repo",
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 1024 * 1024,
          },
        );
      } catch (e) {
        if (e.status === 1) added += String(e.stdout);
        else throw e;
      }
    }
    emit(
      status === "completed"
        ? "agent.run.completed"
        : status === "cancelled"
          ? "agent.run.cancelled"
          : "agent.run.failed",
      { summary, diff: diff + added, changed_files, code: error },
    );
  } catch {
    emit("agent.run.failed", { code: "artifact_export_failed", summary });
  } finally {
    child?.kill("SIGTERM");
    setTimeout(() => process.exit(0), 100).unref();
  }
}
try {
  if (
    !["kubernetes", "container-test"].includes(
      process.env.JARVIS_WORKER_SANDBOX,
    )
  )
    throw Error("isolated_worker_required");
  const input = JSON.parse(process.env.RUN_INPUT);
  if (
    !/^https:\/\//.test(input.workspace?.repository) ||
    !/^[a-f0-9]{40}$/.test(input.workspace?.commit)
  )
    throw Error("repository_and_pinned_commit_required");
  if (!input.model) throw Error("codex_model_required");
  await mkdir("/workspace/repo", { recursive: true });
  await mkdir("/workspace/codex", { recursive: true });
  await copyFile("/credentials/auth.json", "/workspace/codex/auth.json");
  await chmod("/workspace/codex/auth.json", 0o600);
  git(["init"]);
  git(["remote", "add", "origin", input.workspace.repository]);
  git(["fetch", "--depth", "1", "origin", input.workspace.commit]);
  git(["checkout", "--detach", input.workspace.commit]);
  child = spawn("codex", ["app-server"], {
    cwd: "/workspace/repo",
    env: {
      ...process.env,
      CODEX_HOME: "/workspace/codex",
      HOME: "/workspace",
      RUN_INPUT: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", () => {});
  child.on("error", () => void finish("failed", "codex_launch_failed"));
  child.on("exit", () => {
    if (!finished) void finish("failed", "codex_disconnected");
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    void (async () => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        throw Error("invalid_codex_frame");
      }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(Error("codex_rpc_error"));
        else p.resolve(m.result);
        return;
      }
      if (m.id !== undefined && m.method) {
        if (m.method === "item/tool/requestUserInput") {
          question = m;
          emit("agent.waiting_user", {
            title: "需要补充输入",
            questions: m.params.questions,
          });
          return;
        }
        if (!m.method.endsWith("/requestApproval")) {
          child.stdin.write(
            JSON.stringify({
              id: m.id,
              error: { code: -32601, message: "Unsupported worker capability" },
            }) + "\n",
          );
          return;
        }
        child.stdin.write(
          JSON.stringify({ id: m.id, result: { decision: "decline" } }) + "\n",
        );
        emit("agent.approval.required", {
          title: "越过沙箱的操作已拒绝",
          denied: true,
        });
        return;
      }
      const p = m.params ?? {};
      switch (m.method) {
        case "item/agentMessage/delta":
          summary += p.delta ?? "";
          emit("agent.message.delta", { delta: p.delta ?? "" });
          break;
        case "item/started":
        case "item/completed":
          if (
            ["commandExecution", "fileChange", "mcpToolCall"].includes(
              p.item?.type,
            )
          )
            emit(
              m.method === "item/started"
                ? "agent.tool.started"
                : p.item.status === "failed"
                  ? "agent.tool.failed"
                  : "agent.tool.completed",
              {
                title:
                  p.item.type === "commandExecution"
                    ? "执行命令"
                    : "处理代码变更",
                tool: p.item.type,
                item_id: p.item.id,
                command: p.item.command,
                output: p.item.aggregatedOutput,
                exit_code: p.item.exitCode,
              },
            );
          break;
        case "thread/tokenUsage/updated": {
          const u = p.tokenUsage?.total;
          if (!u) break;
          const delta = (k) => Math.max(0, (u[k] ?? 0) - (lastUsage[k] ?? 0));
          emit("agent.usage.updated", {
            provider: "openai",
            model: input.model ?? "unknown",
            input_tokens: delta("inputTokens"),
            output_tokens: delta("outputTokens"),
            cached_input_tokens: delta("cachedInputTokens"),
            reasoning_tokens: delta("reasoningOutputTokens"),
          });
          lastUsage = u;
          break;
        }
        case "turn/completed":
          turnId = undefined;
          await finish(
            p.turn.status === "completed"
              ? "completed"
              : p.turn.status === "interrupted"
                ? "cancelled"
                : "failed",
            p.turn.error?.message,
          );
          break;
        case "error":
          emit("agent.progress", {
            title: "模型连接遇到错误",
            retrying: !!p.willRetry,
          });
          break;
      }
    })().catch(() => void finish("failed", "codex_protocol_error"));
  });
  await rpc("initialize", {
    clientInfo: { name: "jarvis-worker", version: "0.2.0" },
    capabilities: { experimentalApi: false },
  });
  child.stdin.write(
    JSON.stringify({ method: "initialized", params: {} }) + "\n",
  );
  const account = await rpc("account/read", { refreshToken: false });
  if (!account.account) throw Error("codex_login_unavailable");
  await saveLogin();
  authTimer = setInterval(() => void saveLogin().catch(() => {}), 30000);
  authTimer.unref();
  const thread = await rpc("thread/start", {
    cwd: "/workspace/repo",
    approvalPolicy: "never",
    sandbox: "workspace-write",
    ...(input.model ? { model: input.model } : {}),
  });
  threadId = thread.thread.id;
  await writeFile(
    "/workspace/runtime.json",
    JSON.stringify({ thread_id: threadId, model: input.model }),
  );
  emit("agent.run.started", { title: "隔离工作区已就绪", model: input.model });
  const turn = await rpc("turn/start", {
    threadId,
    input: [{ type: "text", text: input.goal }],
    cwd: "/workspace/repo",
    approvalPolicy: "never",
    sandboxPolicy: {
      type: "externalSandbox",
      networkAccess: "enabled",
    },
    model: input.model,
    effort: "low",
    serviceTier: null,
  });
  turnId = turn.turn.id;
  createInterface({ input: process.stdin }).on("line", (line) => {
    void (async () => {
      let m;
      try {
        m = JSON.parse(line);
        if (
          finished ||
          !["send", "resume"].includes(m.method) ||
          typeof m.input?.text !== "string"
        )
          throw Error("invalid_input");
        if (question) {
          const answers = Object.fromEntries(
            (question.params.questions ?? []).map((q) => [
              q.id,
              { answers: [m.input.text] },
            ]),
          );
          child.stdin.write(
            JSON.stringify({ id: question.id, result: { answers } }) + "\n",
          );
          question = undefined;
        } else if (turnId) {
          await rpc("turn/steer", {
            threadId,
            expectedTurnId: turnId,
            input: [{ type: "text", text: m.input.text }],
          });
        } else {
          await rpc("thread/resume", { threadId, cwd: "/workspace/repo" });
          throw Error("run_already_finished");
        }
        process.stdout.write(
          JSON.stringify({ control_id: m.id, result: { accepted: true } }) +
            "\n",
        );
      } catch (e) {
        if (m?.id)
          process.stdout.write(
            JSON.stringify({ control_id: m.id, error: e.message }) + "\n",
          );
      }
    })();
  });
  process.on("SIGTERM", () => {
    void (async () => {
      try {
        if (turnId) await rpc("turn/interrupt", { threadId, turnId });
      } finally {
        await finish("cancelled");
      }
    })();
  });
} catch (e) {
  clearInterval(authTimer);
  await saveLogin().catch(() => {});
  emit("agent.run.failed", { code: e.message });
  child?.kill();
  process.exitCode = 1;
}
