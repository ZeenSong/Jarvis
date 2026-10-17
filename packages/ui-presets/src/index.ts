import { intentSchema, viewSchema, type ViewSpec } from "../../ui-protocol/src/index.js";
import { composeBlocks, defaultViewType, findViewType, viewTypes, type ViewType } from "./registry.js";

export {
  composeBlocks,
  defaultViewType,
  findViewType,
  viewTypes,
  type PresetBlock,
  type ViewType,
  type ViewTypeName,
} from "./registry.js";

/**
 * Resolve the view type a request asks for, plus the resource it is about.
 * Exported so callers can explain an empty result ("this view needs a task")
 * without guessing from the produced blocks.
 */
export function resolveViewType(input: unknown): { type: ViewType; matched?: string } {
  const request = intentSchema.parse(input);
  const type = findViewType(request.intent);
  if (!type) throw Error("view_intent_unknown");
  if (!type.matchPrefix) return { type };
  const matched = request.resources.find((resource) => resource.startsWith(type.matchPrefix!));
  if (!matched) throw Error("view_resource_required");
  return { type, matched };
}

/**
 * Build the legacy v1 dashboard for a request.
 *
 * The whole shape comes from the table in `registry.ts`: a new view type is one
 * entry there, and adding it here is not needed.
 */
export function preset(input: unknown): ViewSpec {
  const { type, matched } = resolveViewType(input);
  return viewSchema.parse({
    version: 1,
    type: "dashboard",
    title: type.title,
    blocks: composeBlocks(type, matched),
  });
}

/** Every intent that resolves to the default dashboard when it carries no resource. */
export const viewIntents = Object.keys(viewTypes);
export const fallbackIntent = defaultViewType;
