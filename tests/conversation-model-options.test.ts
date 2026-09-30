import test from "node:test";
import assert from "node:assert/strict";
import { modelSupportsReasoning, reasoningEfforts } from "../packages/conversation/src/model-options.js";

test("Composer reasoning control requires an explicit capability for the active provider and model", () => {
  const catalog = {
    provider: "openai",
    model: "gpt-5",
    providers: [
      { slug: "openai", models: ["gpt-5"], capabilities: { "gpt-5": { reasoning: true } } },
      { slug: "local", models: ["gpt-5"], capabilities: { "gpt-5": { reasoning: false } } },
    ],
  };
  assert.equal(modelSupportsReasoning(catalog, "gpt-5", "openai"), true);
  assert.equal(modelSupportsReasoning(catalog, "gpt-5", "missing"), false);
  assert.equal(modelSupportsReasoning(catalog, "other-model", "openai"), false);
  assert.equal(modelSupportsReasoning({ providers: [{ slug: "openai", capabilities: { "gpt-5": {} } }] }, "gpt-5", "openai"), false);
  assert.deepEqual(reasoningEfforts, ["low", "medium", "high"]);
});
