import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { adaptInstaller } from "./casaos-host.mjs";
import { isolatedStatus } from "./casaos-dependencies.mjs";

test("unreviewed upstream content is rejected before execution", () => {
  assert.throws(() => adaptInstaller("#!/bin/bash\necho changed\n"), /checksum changed/);
});

test("prepared installer has exactly the two reviewed changes", async () => {
  const original = await readFile(new URL("../../.local/m3-casaos/upstream.sh", import.meta.url), "utf8");
  const prepared = adaptInstaller(original);
  assert.equal(prepared, adaptInstaller(original));
  assert.ok(!prepared.includes("\nApply_Docker_API_Override\n"));
  assert.ok(prepared.includes("TMP_ROOT=$(mktemp -d /tmp/jarvis-casaos.XXXXXXXX)"));
  const restored = prepared.replace("\n# Jarvis: retain Docker configuration and running daemon.\n", "\nApply_Docker_API_Override\n")
    .replace("TMP_ROOT=$(mktemp -d /tmp/jarvis-casaos.XXXXXXXX)", "TMP_ROOT=/tmp/casaos-installer");
  assert.equal(restored, original);
});

test("without-APT mode skips package manager calls but retains dependency verification", async () => {
  const original = await readFile(new URL("../../.local/m3-casaos/upstream.sh", import.meta.url), "utf8");
  const prepared = adaptInstaller(original, true);
  assert.ok(!prepared.includes("\nUpdate_Package_Resource\n"));
  assert.ok(!prepared.includes("\nInstall_Depends\n"));
  assert.ok(prepared.includes("\nCheck_Dependency_Installation\n"));
  assert.ok(!prepared.includes("\nApply_Docker_API_Override\n"));
});

test("solver shadow omits only known stale package, preserving all other records", () => {
  const a = "Package: samba-libs\nStatus: install ok installed\nVersion: 1";
  const b = "Package: xserver-xorg-video-nvidia-570\nStatus: install ok installed";
  const c = "Package: libnvidia-other\nStatus: install ok installed";
  const status = [a, b, c].join("\n\n");
  assert.equal(isolatedStatus(status), [a, c].join("\n\n"));
  assert.ok(status.includes(b));
});

test("install refuses non-root invocation before changing host state", { skip: process.getuid?.() === 0 }, async () => {
  await assert.rejects(promisify(execFile)(process.execPath, [new URL("./casaos-host.mjs", import.meta.url).pathname, "install"]),
    (error) => error.code === 1 && error.stderr.includes("requires sudo"));
});
