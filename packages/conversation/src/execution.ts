/** Durable, ordered presentation of a turn; raw activity evidence stays separate. */
export type ExecutionKind = "reasoning" | "skill" | "tool" | "processing" | "approval" | "question" | "render" | "answer" | "result";
export type ExecutionEvent = {
  id: string;
  conversation_id: string;
  turn_id: string;
  sequence: number;
  revision: number;
  kind: ExecutionKind;
  status: string;
  title: string;
  content: string;
  activity_id?: string;
  started_at: string;
  completed_at?: string;
};

export function mergeExecution(events: readonly ExecutionEvent[], next: ExecutionEvent): ExecutionEvent[] {
  const previous = events.find((event) => event.id === next.id);
  if (previous && Number(previous.revision) >= Number(next.revision)) return [...events];
  return [...events.filter((event) => event.id !== next.id), next].sort((a, b) => Number(a.sequence) - Number(b.sequence));
}
