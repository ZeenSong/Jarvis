import { randomUUID } from "node:crypto";
import type { Database } from "../../../apps/server/src/persistence.js";
import {
  registrationSchema,
  heartbeatSchema,
} from "../../protocol/src/index.js";
export function effectiveStatus(
  status: string,
  lastSeen: Date,
  now = Date.now(),
  degraded = 30,
  offline = 90,
) {
  const age = (now - lastSeen.getTime()) / 1000;
  return age > offline ? "offline" : age > degraded ? "degraded" : status;
}
export class AgentRegistry {
  constructor(
    private db: Database,
    private emit: (topic: string, payload: unknown) => void,
    private degraded = 30,
    private offline = 90,
  ) {}
  async list() {
    return (await this.db.query("SELECT * FROM agents ORDER BY name")).rows;
  }
  async get(id: string) {
    return (
      await this.db.query(
        "SELECT a.*,s.started_at AS session_start FROM agents a LEFT JOIN agent_sessions s ON s.agent_id=a.id AND s.ended_at IS NULL WHERE a.id=$1",
        [id],
      )
    ).rows[0];
  }
  async events(id: string) {
    return (
      await this.db.query(
        "SELECT * FROM agent_events WHERE agent_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
        [id],
      )
    ).rows;
  }
  async register(payload: unknown, owner: string) {
    const p = registrationSchema.parse(payload);
    const c = await this.db.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query(
        `INSERT INTO agents(id,owner_device_id,name,runtime,version,capabilities,status,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,'online',now()) ON CONFLICT(id) DO UPDATE SET name=$3,runtime=$4,version=$5,capabilities=$6,status='online',last_seen_at=now(),updated_at=now() WHERE agents.owner_device_id=$2 RETURNING *`,
        [
          p.agent_id,
          owner,
          p.name,
          p.runtime,
          p.version,
          JSON.stringify(p.capabilities),
        ],
      );
      if (!r.rowCount) throw new Error("agent_not_owned");
      await c.query(
        "INSERT INTO agent_sessions(id,agent_id,status,started_at) VALUES($1,$2,'online',now()) ON CONFLICT DO NOTHING",
        [randomUUID(), p.agent_id],
      );
      await c.query(
        "INSERT INTO agent_events(agent_id,event_type,payload) VALUES($1,$2,$3)",
        [p.agent_id, "agent.register", JSON.stringify(p)],
      );
      await c.query("COMMIT");
      this.emit("agent.status.changed", r.rows[0]);
      return r.rows[0];
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async heartbeat(payload: unknown, owner: string, topic = "agent.heartbeat") {
    const p = heartbeatSchema.parse(payload),
      c = await this.db.connect();
    try {
      await c.query("BEGIN");
      const previous = (
        await c.query(
          "SELECT * FROM agents WHERE id=$1 AND owner_device_id=$2 FOR UPDATE",
          [p.agent_id, owner],
        )
      ).rows[0];
      if (!previous) throw new Error("agent_not_owned");
      const state =
        topic === "agent.task.started"
          ? "running"
          : topic === "agent.task.finished"
            ? "idle"
            : topic === "agent.error"
              ? "error"
              : p.status;
      const task =
        topic === "agent.task.finished"
          ? null
          : p.task_id === undefined
            ? previous.current_task_id
            : p.task_id;
      const r = await c.query(
        "UPDATE agents SET status=$2,provider=$3,model=$4,current_task_id=$5,last_seen_at=now(),updated_at=now() WHERE id=$1 RETURNING *",
        [
          p.agent_id,
          state,
          p.provider === undefined ? previous.provider : p.provider,
          p.model === undefined ? previous.model : p.model,
          task,
        ],
      );
      await c.query(
        "INSERT INTO agent_sessions(id,agent_id,status,started_at) VALUES($1,$2,$3,now()) ON CONFLICT DO NOTHING",
        [randomUUID(), p.agent_id, state],
      );
      await c.query(
        "UPDATE agent_sessions SET status=$2,provider=$3,model=$4 WHERE agent_id=$1 AND ended_at IS NULL",
        [p.agent_id, state, r.rows[0].provider, r.rows[0].model],
      );
      if (topic !== "agent.heartbeat" || previous.status !== state)
        await c.query(
          "INSERT INTO agent_events(agent_id,event_type,task_id,payload) VALUES($1,$2,$3,$4)",
          [p.agent_id, topic, task, JSON.stringify(p)],
        );
      await c.query("COMMIT");
      this.emit("agent.status.changed", r.rows[0]);
      return r.rows[0];
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async sweep() {
    const r = await this.db.query(
      `UPDATE agents SET status=CASE WHEN last_seen_at<now()-$2*interval '1 second' THEN 'offline' ELSE 'degraded' END,updated_at=now() WHERE last_seen_at<now()-$1*interval '1 second' AND status IS DISTINCT FROM CASE WHEN last_seen_at<now()-$2*interval '1 second' THEN 'offline' ELSE 'degraded' END RETURNING *`,
      [this.degraded, this.offline],
    );
    for (const a of r.rows) {
      await this.db.query(
        "INSERT INTO agent_events(agent_id,event_type,payload) VALUES($1,$2,$3)",
        [a.id, "agent.status.changed", JSON.stringify({ status: a.status })],
      );
      this.emit("agent.status.changed", a);
    }
    await this.db.query(
      "UPDATE agent_sessions SET status='offline',ended_at=now() WHERE ended_at IS NULL AND agent_id IN (SELECT id FROM agents WHERE status='offline')",
    );
  }
}
