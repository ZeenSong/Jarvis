import type { HermesModelOptions } from "../../hermes-bridge/src/index.js";

export const reasoningEfforts = ["low", "medium", "high"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

/** Hermes exposes reasoning as a per-model capability. Do not infer support
 * from the provider's defaults or from a model name. */
export function modelSupportsReasoning(options: HermesModelOptions, model: string, provider?: string) {
  const requestedModel = model.trim().toLowerCase();
  if (!requestedModel) return false;
  const providers = Array.isArray(options.providers)
    ? options.providers
    : options.providers && typeof options.providers === "object"
      ? Object.values(options.providers as Record<string, unknown>)
      : [];
  return providers.some((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entry = value as Record<string, unknown>;
    const slug = String(entry.slug ?? entry.name ?? "").trim().toLowerCase();
    if (provider && slug && slug !== provider.trim().toLowerCase()) return false;
    if (!entry.capabilities || typeof entry.capabilities !== "object" || Array.isArray(entry.capabilities)) return false;
    const capabilities = entry.capabilities as Record<string, unknown>;
    const modelCapability = Object.entries(capabilities).find(([name]) => name.trim().toLowerCase() === requestedModel)?.[1];
    return Boolean(modelCapability && typeof modelCapability === "object" && !Array.isArray(modelCapability)
      && (modelCapability as Record<string, unknown>).reasoning === true);
  });
}
