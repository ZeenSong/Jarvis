import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { database, migrate } from "../apps/server/src/persistence.js";
import {
  pair,
  createPairingCode,
  authenticate,
} from "../apps/server/src/auth.js";
test(
  "M1 populated schema migrates twice without changing devices, events or historical billing",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const admin = database(url),
      schema = "m2_compat_" + randomUUID().replaceAll("-", "");
    const isolated = new URL(url);
    isolated.searchParams.set("options", "-csearch_path=" + schema);
    const db = database(isolated.toString());
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await db.query(await readFile("tests/fixtures/m1-schema.sql", "utf8"));
      const device = await pair(db, randomUUID(), await createPairingCode(db));
      await db.query(
        "INSERT INTO agents(id,owner_device_id,name,status,provider,model) VALUES('legacy',$1,'M1 Agent','idle','original-provider','original-model')",
        [device.device_id],
      );
      await db.query(
        "INSERT INTO agent_sessions(id,agent_id,started_at) VALUES($1,'legacy',now())",
        [randomUUID()],
      );
      await db.query(
        "INSERT INTO agent_events(agent_id,event_type,payload) VALUES('legacy','agent.task.completed','{\"summary\":\"历史任务\"}')",
      );
      await db.query(
        "INSERT INTO llm_requests(id,agent_id,provider,model,input_tokens,output_tokens,estimated_cost_usd,status,started_at) VALUES($1,'legacy','original-provider','original-model',123,45,1.23456789,'success',now())",
        [randomUUID()],
      );
      const tables = [
        "devices",
        "agents",
        "agent_sessions",
        "agent_events",
        "llm_requests",
      ];
      const before = await Promise.all(
        tables.map((t) => db.query(`SELECT row_to_json(t) value FROM ${t} t`)),
      );
      await migrate(db);
      await migrate(db);
      for (let i = 0; i < tables.length; i++) {
        const after = (
          await db.query(`SELECT row_to_json(t) value FROM ${tables[i]} t`)
        ).rows[0].value;
        const original = before[i].rows[0].value;
        assert.deepEqual(
          Object.fromEntries(Object.keys(original).map((k) => [k, after[k]])),
          original,
          tables[i],
        );
      }
      assert.equal(
        (await authenticate(db, "Bearer " + device.token))?.id,
        device.device_id,
      );
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM agent_definitions"))
          .rows[0].n,
        3,
      );
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM run_events")).rows[0].n,
        0,
      );
    } finally {
      await db.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  },
);
