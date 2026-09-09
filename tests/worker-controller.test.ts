import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  buildController,
  type KubeRequest,
} from "../apps/worker-controller/src/controller.js";

test("controller uses fixed isolated Jobs, idempotency and archive-before-disposal", async () => {
  const calls: any[] = [];
  const jobs = new Map<string, any>();
  let pod: any;
  let done = false;
  const kube: KubeRequest = async (path, method = "GET", body) => {
    assert.ok(path.includes("/namespaces/jarvis-workers/"));
    calls.push({ path, method, body });
    if (path.includes("/pods?")) return { items: pod ? [pod] : [] };
    if (path.includes("/persistentvolumeclaims"))
      return method === "POST" ? body : { items: [] };
    if (method === "POST") {
      jobs.set((body as any).metadata.name, body);
      return body;
    }
    const name = path.split("/").at(-1)!;
    if (method === "DELETE") {
      jobs.delete(name);
      return {};
    }
    if (path.includes("?")) return { items: [...jobs.values()] };
    if (!jobs.has(name)) throw Error("kubernetes_http_404");
    return jobs.get(name);
  };
  const workerCalls: string[] = [];
  const app = buildController(
    kube,
    {
      CONTROLLER_TOKEN: "test-controller-token",
      CODING_REPOSITORY: "https://github.com/example/repo.git",
      CODEX_WORKER_IMAGE: "fixed-codex:version",
      OPS_WORKER_IMAGE: "fixed-ops:version",
    },
    async (url, init) => {
      workerCalls.push(String(url));
      assert.match((init?.headers as any).authorization, /^Bearer /);
      if (String(url).endsWith("/dispose") && !done)
        return Response.json({ error: "archive_not_ready" }, { status: 409 });
      return Response.json({ accepted: true, done });
    },
  );
  try {
    const headers = { authorization: "Bearer test-controller-token" };
    const input = {
      id: randomUUID(),
      type: "codex",
      model: "gpt-5.6-luna",
      goal: "test",
      workspace: {
        repository: "https://github.com/example/repo.git",
        commit: "a".repeat(40),
      },
    };
    assert.equal(
      (await app.inject({ method: "POST", url: "/runs", payload: input }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/runs",
          headers,
          payload: { ...input, image: "untrusted", command: "shell" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/runs",
          headers,
          payload: input,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/runs",
          headers,
          payload: input,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      calls.filter((c) => c.method === "POST" && c.path.endsWith("/jobs"))
        .length,
      1,
    );
    const job = jobs.get("run-" + input.id),
      spec = job.spec.template.spec;
    assert.equal(spec.automountServiceAccountToken, false);
    assert.equal(spec.securityContext.runAsNonRoot, true);
    assert.equal(spec.containers[0].image, "fixed-codex:version");
    assert.equal(
      spec.containers[0].securityContext.readOnlyRootFilesystem,
      true,
    );
    assert.deepEqual(spec.containers[0].securityContext.capabilities.drop, [
      "ALL",
    ]);
    assert.equal(
      spec.volumes.some((v: any) => v.hostPath),
      false,
    );
    assert.ok(
      spec.volumes.some(
        (v: any) => v.persistentVolumeClaim?.claimName === "codex-auth",
      ),
    );
    assert.equal(job.spec.backoffLimit, 0);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/runs",
          headers,
          payload: { ...input, goal: "changed" },
        })
      ).statusCode,
      503,
    );
    pod = {
      metadata: { name: "worker", creationTimestamp: new Date().toISOString() },
      status: { phase: "Running", podIP: "192.0.2.20" },
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/runs/${input.id}/cancel`,
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.ok(workerCalls.at(-1)?.endsWith("/cancel"));
    assert.equal(jobs.size, 1);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/runs/${input.id}/dispose`,
          headers,
          payload: {},
        })
      ).statusCode,
      503,
    );
    assert.equal(
      jobs.size,
      1,
      "Worker must survive until terminal export is ready",
    );
    done = true;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/runs/${input.id}/dispose`,
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(jobs.size, 0);
  } finally {
    await app.close();
  }
});
