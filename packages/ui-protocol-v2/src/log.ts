/** Plain-text log snapshots; terminal control codes are never interpreted. */
export function logSnapshot(value: unknown): { lines: string[]; truncated: boolean } | undefined {
  const text = typeof value === "string" ? value : value && typeof value === "object" &&
    "text" in value && typeof value.text === "string" ? value.text : undefined;
  if (text === undefined) return undefined;
  const bounded = text.slice(-200_000).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n/g, "\n");
  const lines = bounded ? bounded.split("\n") : [];
  return { lines: lines.slice(-1000), truncated: text.length > 200_000 || lines.length > 1000 };
}
