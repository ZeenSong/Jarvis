import { test } from "node:test";
import assert from "node:assert/strict";
import { logSnapshot } from "../packages/ui-protocol-v2/src/log.js";

test("log snapshots preserve text, remove ANSI and distinguish malformed from empty", () => {
  assert.deepEqual(logSnapshot({ text: "\u001b[31merror\u001b[0m\r\n<script>" }), { lines: ["error", "<script>"], truncated: false });
  assert.deepEqual(logSnapshot(""), { lines: [], truncated: false });
  assert.equal(logSnapshot({ secret: "not a log" }), undefined);
});
test("log snapshots bound rendering and retain the latest lines", () => {
  const snapshot = logSnapshot(Array.from({ length: 1200 }, (_, i) => `line ${i}`).join("\n"))!;
  assert.equal(snapshot.lines.length, 1000);
  assert.equal(snapshot.lines[0], "line 200");
  assert.equal(snapshot.lines.at(-1), "line 1199");
  assert.equal(snapshot.truncated, true);
  assert.equal(logSnapshot("x".repeat(200001))!.lines[0].length, 200000);
});
