import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { buildApp } from "../apps/server/src/app.js";
import { createPairingCode } from "../apps/server/src/auth.js";
const url = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL + authenticated WebSocket + Agent lifecycle + usage + restart",
  { skip: !url },
  async () => {
    const ctx = await buildApp({
      databaseUrl: url!,
      degradedSeconds: 1,
      offlineSeconds: 3,
      prices: {
        test: {
          model: {
            input_per_million: 2,
            output_per_million: 8,
            cached_input_per_million: 0.2,
            valid_from: "2020-01-01",
          },
        },
      },
    });
    const { app, db, agents } = ctx;
    let client: WebSocket | undefined, phone: WebSocket | undefined;
    const id = "integration-" + randomUUID();
    let token = "";
    let deviceToken = "";
    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
      assert.equal((await app.inject("/health/ready")).statusCode, 200);
      assert.equal((await app.inject("/api/v1/agents")).statusCode, 401);
      const code = await createPairingCode(db, "agent");
      const paired = await app.inject({
        method: "POST",
        url: "/api/v1/pair",
        payload: { device_id: randomUUID(), code },
      });
      assert.equal(paired.statusCode, 200);
      token = paired.json().token;
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/pair",
            payload: { device_id: randomUUID(), code },
          })
        ).statusCode,
        401,
      );
      const deviceCode = await createPairingCode(db);
      const device = await app.inject({
        method: "POST",
        url: "/api/v1/pair",
        payload: { device_id: randomUUID(), code: deviceCode },
      });
      deviceToken = device.json().token;
      const auth = { authorization: `Bearer ${token}` };
      const unauthorized = new WebSocket(base.replace("http", "ws") + "/ws");
      const rejected = await new Promise<number>((resolve) => {
        unauthorized.on("unexpected-response", (_req, res) => {
          resolve(res.statusCode!);
          unauthorized.terminate();
        });
        unauthorized.on("error", () => {});
      });
      assert.equal(rejected, 401);
      client = new WebSocket(base.replace("http", "ws") + "/ws", {
        headers: auth,
      });
      await once(client, "open");
      phone = new WebSocket(base.replace("http", "ws") + "/ws", {
        headers: { Authorization: `Bearer ${deviceToken}` },
      });
      await once(phone, "open");
      const events: any[] = [];
      phone.on("message", (raw) => events.push(JSON.parse(raw.toString())));
      function rpc(
        ws: WebSocket,
        topic: string,
        payload: unknown = {},
        messageId = randomUUID(),
      ): Promise<any> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            ws.off("message", onMessage);
            reject(new Error(`timeout:${topic}`));
          }, 5000);
          function onMessage(raw: any) {
            const m = JSON.parse(raw.toString());
            if (m.reply_to === messageId) {
              clearTimeout(timer);
              ws.off("message", onMessage);
              resolve(m);
            }
          }
          ws.on("message", onMessage);
          ws.send(
            JSON.stringify({ id: messageId, type: "request", topic, payload }),
          );
        });
      }
      assert.equal((await rpc(client, "gateway.ping")).topic, "gateway.pong");
      assert.equal(
        (
          await rpc(phone, "agent.register", {
            agent_id: id,
            name: "forbidden",
          })
        ).type,
        "error",
      );
      const registered = await rpc(client, "agent.register", {
        agent_id: id,
        name: "Integration",
        runtime: "test",
      });
      assert.equal(registered.payload.status, "online");
      await rpc(client, "agent.task.started", {
        agent_id: id,
        status: "running",
        task_id: "task-1",
        provider: "test",
        model: "model",
      });
      assert.equal((await agents.get(id)).current_task_id, "task-1");
      await db.query(
        "UPDATE agents SET last_seen_at=now()-interval '2 seconds' WHERE id=$1",
        [id],
      );
      await agents.sweep();
      assert.equal((await agents.get(id)).status, "degraded");
      await db.query(
        "UPDATE agents SET last_seen_at=now()-interval '4 seconds' WHERE id=$1",
        [id],
      );
      await agents.sweep();
      assert.equal((await agents.get(id)).status, "offline");
      await rpc(client, "agent.heartbeat", { agent_id: id, status: "idle" });
      assert.equal((await agents.get(id)).status, "idle");
      assert.equal(
        (
          await db.query(
            "SELECT * FROM agent_sessions WHERE agent_id=$1 AND ended_at IS NOT NULL",
            [id],
          )
        ).rowCount,
        1,
      );
      const started = new Date(Date.now() - 1000).toISOString();
      const usage = {
        id: randomUUID(),
        agent_id: id,
        provider: "test",
        model: "model",
        input_tokens: 1000000,
        output_tokens: 100000,
        cached_input_tokens: 250000,
        reasoning_tokens: 100,
        latency_ms: 10,
        status: "success",
        started_at: started,
        finished_at: new Date().toISOString(),
      };
      assert.equal(
        (await rpc(client, "llm.request.completed", usage)).payload.inserted,
        true,
      );
      assert.equal(
        (await rpc(client, "llm.request.completed", usage)).payload.inserted,
        false,
      );
      const summary = await rpc(phone, "llm.usage.summary", {
        range: "today",
        agent_id: id,
      });
      assert.equal(summary.payload.total.requests, 1);
      assert.equal(summary.payload.total.estimated_cost_usd, 2.35);
      assert.equal(summary.payload.total.reasoning_tokens, 100);
      await rpc(client, "llm.request.completed", {
        ...usage,
        id: randomUUID(),
        status: "error",
        error_type: "timeout",
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        reasoning_tokens: 0,
      });
      const month = await rpc(phone, "llm.usage.summary", {
        range: "month",
        group_by: "model",
        agent_id: id,
      });
      assert.equal(month.payload.total.errors, 1);
      assert.equal(month.payload.groups[0].model, "model");
      await rpc(client, "agent.task.finished", {
        agent_id: id,
        status: "idle",
      });
      assert.equal((await agents.get(id)).current_task_id, null);
      const system = await rpc(phone, "system.status.get");
      for (const key of [
        "server",
        "cpu",
        "memory",
        "disks",
        "gpu",
        "network",
        "jarvis",
      ])
        assert.ok(key in system.payload);
      assert.ok(system.payload.memory.total_bytes > 0);
      await rpc(phone, "gateway.subscribe", {
        topics: [
          "system.status.changed",
          "agent.status.changed",
          "llm.usage.changed",
        ],
      });
      await new Promise((r) => setTimeout(r, 2200));
      assert.ok(events.some((e) => e.topic === "system.status.changed"));
      assert.ok(events.some((e) => e.topic === "llm.usage.changed"));
      const sameId = randomUUID();
      const first = await rpc(client, "gateway.ping", {}, sameId);
      assert.deepEqual(await rpc(client, "gateway.ping", {}, sameId), first);
      assert.equal((await rpc(client, "agent.list", {}, sameId)).type, "error");
      assert.ok((await agents.events(id)).length >= 4);
    } finally {
      client?.terminate();
      phone?.terminate();
      await app.close();
    }
    const restarted = await buildApp({ databaseUrl: url! });
    try {
      const response = await restarted.app.inject({
        url: `/api/v1/agents/${id}`,
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().id, id);
      const history = await restarted.app.inject({
        url: `/api/v1/llm/usage?range=month&agent_id=${id}`,
        headers: { authorization: `Bearer ${deviceToken}` },
      });
      assert.equal(history.json().total.requests, 2);
    } finally {
      await restarted.app.close();
    }
  },
);
