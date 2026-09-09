import Fastify from "fastify";
import { timingSafeEqual, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
export type KubeRequest = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<any>;
export function buildController(
  kube: KubeRequest,
  config: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch,
) {
  const namespace = "jarvis-workers";
  const app = Fastify({ bodyLimit: 65536 });
  app.addHook("onRequest", async (req, reply) => {
    const expected = Buffer.from("Bearer " + (config.CONTROLLER_TOKEN ?? "")),
      actual = Buffer.from(req.headers.authorization ?? "");
    if (
      !config.CONTROLLER_TOKEN ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      return reply.code(401).send({ error: "unauthorized" });
  });
  const runInput = z
    .object({
      id: z.uuid(),
      goal: z.string().min(1).max(16000),
      type: z.enum(["codex", "pydantic"]),
      model: z.string().max(100).optional(),
      workspace: z
        .object({
          repository: z.string().url(),
          commit: z.string().regex(/^[a-f0-9]{40}$/),
        })
        .optional(),
    })
    .strict();
  const batch = `/apis/batch/v1/namespaces/${namespace}/jobs`,
    core = `/api/v1/namespaces/${namespace}`;
  const name = (id: string) => "run-" + z.uuid().parse(id);
  const workerToken = (id: string) =>
    createHmac("sha256", config.CONTROLLER_TOKEN!)
      .update(z.uuid().parse(id))
      .digest("base64url");
  async function podFor(id: string) {
    const pods = await kube(
      core +
        "/pods?labelSelector=" +
        encodeURIComponent("job-name=" + name(id)),
    );
    return pods.items[0];
  }
  async function worker(id: string, path: string, body?: unknown) {
    const pod = await podFor(id);
    const ip = pod?.status?.podIP;
    if (!ip || !isIP(ip)) throw Error("worker_not_ready");
    const response = await transport(
      `http://${isIP(ip) === 6 ? "[" + ip + "]" : ip}:8091${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: "Bearer " + workerToken(id),
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw Error("worker_control_http_" + response.status);
    return response.json();
  }
  app.get("/health", async () => {
    await kube(batch + "?limit=1");
    return { healthy: true };
  });
  app.post("/runs", async (req) => {
    const p = runInput.parse(req.body),
      job = name(p.id),
      coding = p.type === "codex";
    if (
      coding &&
      (!p.workspace || p.workspace.repository !== config.CODING_REPOSITORY)
    )
      throw Error("repository_not_allowed");
    const image = coding ? config.CODEX_WORKER_IMAGE : config.OPS_WORKER_IMAGE;
    if (!image) throw Error("worker_image_missing");
    try {
      const existing = await kube(batch + "/" + job);
      if (existing.metadata.annotations?.["jarvis/input"] !== JSON.stringify(p))
        throw Error("idempotency_conflict");
      return { id: p.id };
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "kubernetes_http_404") throw e;
    }
    const env: any[] = [
      { name: "WORKER_TOKEN", value: workerToken(p.id) },
      { name: "RUN_INPUT", value: JSON.stringify(p) },
      { name: "JARVIS_WORKER_SANDBOX", value: "kubernetes" },
      { name: "HOME", value: "/workspace" },
      { name: "HTTPS_PROXY", value: config.WORKER_EGRESS_PROXY ?? "" },
      { name: "HTTP_PROXY", value: config.WORKER_EGRESS_PROXY ?? "" },
      {
        name: "NO_PROXY",
        value: "ops-read-gateway.jarvis-workers.svc.cluster.local",
      },
    ];
    const volumes: any[] = [
      { name: "workspace", persistentVolumeClaim: { claimName: job } },
      { name: "tmp", emptyDir: { sizeLimit: "512Mi" } },
    ];
    const mounts: any[] = [
      { name: "workspace", mountPath: "/workspace" },
      { name: "tmp", mountPath: "/tmp" },
    ];
    if (coding) {
      env.push({ name: "CODEX_AUTH_WRITEBACK", value: "1" });
      volumes.push({
        name: "auth",
        persistentVolumeClaim: { claimName: "codex-auth" },
      });
      mounts.push({ name: "auth", mountPath: "/credentials" });
    } else {
      env.push(
        { name: "OPS_MODEL", value: config.OPS_MODEL ?? "" },
        {
          name: "OPS_GATEWAY",
          value:
            "http://ops-read-gateway.jarvis-workers.svc.cluster.local:8092",
        },
        {
          name: "OPS_TOKEN",
          valueFrom: { secretKeyRef: { name: "ops-access", key: "token" } },
        },
        {
          name: "DEEPSEEK_API_KEY",
          valueFrom: {
            secretKeyRef: { name: "ops-access", key: "deepseek-api-key" },
          },
        },
      );
    }
    await kube(core + "/persistentvolumeclaims", "POST", {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: job,
        labels: { app: "jarvis-worker" },
        annotations: {
          "jarvis/expires-at": new Date(Date.now() + 86400000).toISOString(),
        },
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: "5Gi" } },
      },
    }).catch((e) => {
      if (e.message !== "kubernetes_http_409") throw e;
    });
    await kube(batch, "POST", {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: job,
        labels: { app: "jarvis-worker" },
        annotations: { "jarvis/input": JSON.stringify(p) },
      },
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: coding ? 1800 : 300,
        template: {
          metadata: { labels: { app: "jarvis-worker", role: p.type } },
          spec: {
            automountServiceAccountToken: false,
            restartPolicy: "Never",
            terminationGracePeriodSeconds: 20,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1000,
              runAsGroup: 1000,
              fsGroup: 1000,
              seccompProfile: { type: "RuntimeDefault" },
            },
            containers: [
              {
                name: "worker",
                image,
                imagePullPolicy: "IfNotPresent",
                env,
                volumeMounts: mounts,
                resources: {
                  requests: { cpu: "250m", memory: "256Mi" },
                  limits: { cpu: "2", memory: "2Gi" },
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                  capabilities: { drop: ["ALL"] },
                },
              },
            ],
            volumes,
          },
        },
      },
    });
    return { id: p.id };
  });
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
    "/runs/:id/events",
    async (req) => {
      const job = name(req.params.id);
      const cursor = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(req.query.cursor ?? 0);
      const pods = await kube(
        core + "/pods?labelSelector=" + encodeURIComponent("job-name=" + job),
      );
      if (!pods.items.length) {
        const jobState = await kube(batch + "/" + job);
        if (jobState.status?.failed)
          return {
            events: [
              {
                type: "agent.run.failed",
                payload: { code: "worker_job_failed" },
                sequence: 1,
              },
            ],
            done: true,
          };
        return { events: [], done: false };
      }
      const pod = pods.items[0];
      if (pod.status.phase === "Running") {
        try {
          return await worker(req.params.id, `/events?cursor=${cursor}`);
        } catch (e) {
          if (
            Date.now() -
              Date.parse(
                pod.status.startTime ?? pod.metadata.creationTimestamp,
              ) <
            30000
          )
            return { events: [], done: false };
          throw e;
        }
      }
      let logs = "";
      try {
        logs = await kube(core + "/pods/" + pod.metadata.name + "/log");
      } catch (e) {
        if (!["Pending"].includes(pod.status.phase)) throw e;
      }
      const lines = String(logs).split("\n");
      if (!String(logs).endsWith("\n")) lines.pop();
      const events = lines.filter(Boolean).map((line) => JSON.parse(line));
      return {
        events: events.slice(cursor),
        done: ["Succeeded", "Failed"].includes(pod.status.phase),
      };
    },
  );
  app.post<{ Params: { id: string } }>("/runs/:id/cancel", async (req) => {
    const pod = await podFor(req.params.id);
    if (pod?.status.phase === "Running")
      await worker(req.params.id, "/cancel", {});
    else if (!pod || pod.status.phase === "Pending")
      await kube(batch + "/" + name(req.params.id), "DELETE", {
        propagationPolicy: "Foreground",
      }).catch((e) => {
        if (e.message !== "kubernetes_http_404") throw e;
      });
    return { cancelled: true };
  });
  for (const operation of ["send", "resume"] as const)
    app.post<{ Params: { id: string } }>(
      `/runs/:id/${operation}`,
      async (req) => {
        const body = z
          .object({ text: z.string().max(16000).optional() })
          .strict()
          .parse(req.body ?? {});
        return worker(req.params.id, "/" + operation, body);
      },
    );
  app.post<{ Params: { id: string } }>("/runs/:id/dispose", async (req) => {
    const pod = await podFor(req.params.id);
    if (pod?.status.phase === "Running")
      await worker(req.params.id, "/dispose", {});
    await kube(batch + "/" + name(req.params.id), "DELETE", {
      propagationPolicy: "Foreground",
    }).catch((e) => {
      if (e.message !== "kubernetes_http_404") throw e;
    });
    return { disposed: true };
  });
  const cleanup = setInterval(() => {
    void (async () => {
      const claims = await kube(
        core + "/persistentvolumeclaims?labelSelector=app%3Djarvis-worker",
      );
      for (const claim of claims.items) {
        if (
          Date.parse(claim.metadata.annotations?.["jarvis/expires-at"] ?? "") <
          Date.now()
        ) {
          try {
            await kube(batch + "/" + claim.metadata.name);
            continue;
          } catch (e) {
            if ((e as Error).message !== "kubernetes_http_404") throw e;
          }
          await kube(
            core + "/persistentvolumeclaims/" + claim.metadata.name,
            "DELETE",
          );
        }
      }
    })().catch(() => {});
  }, 60000);
  app.addHook("onClose", async () => clearInterval(cleanup));
  app.setErrorHandler((e, _, reply) =>
    reply
      .code(e instanceof z.ZodError ? 400 : 503)
      .send({ error: "worker_controller_failed" }),
  );

  return app;
}
