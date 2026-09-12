import { sectionSchema, type Section } from "./index.js";

/** Resolve a section against a newer server resource, without mutating its saved snapshot. */
export function bindSection(section: Section, resource?: { resource: string; revision: number; data: unknown }): Section {
  if (!resource || resource.resource !== section.source || section.source_revision === undefined || resource.revision <= section.source_revision) return section;
  let data = resource.data;
  for (const key of section.source_path?.split(".").filter(Boolean) ?? []) {
    data = data !== null && typeof data === "object" && Object.hasOwn(data, key) ? (data as Record<string, unknown>)[key] : undefined;
  }
  const parsed = sectionSchema.safeParse({ ...section, source_revision: resource.revision, data: data ?? null });
  return parsed.success ? parsed.data : section;
}
