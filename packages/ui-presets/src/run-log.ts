/** Event metadata only: never serialize tool arguments, output or credentials. */
export function runEventLog(events: unknown): string {
  if (!Array.isArray(events)) return "";
  return events.slice(-1000).map((event) => {
    if (!event || typeof event !== "object") return "";
    const field = (key: string) => {
      const value = event[key];
      return (value instanceof Date ? value.toISOString() : typeof value === "string" || typeof value === "number" ? String(value) : "")
        .replace(/[\r\n\x00-\x1f\x7f]/g, " ").slice(0, 200);
    };
    return [field("timestamp"), field("id"), field("type")].filter(Boolean).join("  ");
  }).filter(Boolean).join("\n");
}
