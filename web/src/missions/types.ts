// Mission Control run shapes (a subset of the engine's RunDetail) and the live
// telemetry event the BFF relays over SSE.

export interface Run {
  run_id: string;
  status: string; // queued | running | awaiting_gate | applied | scrubbed | failed | done | ...
  task_type?: string | null;
  target?: string | null;
  cost_usd?: number | null;
  subject?: string | null;
  detail?: string | null;
  created_at?: string | null;
  ended_at?: string | null;
}

// A relayed telemetry frame: { type: "node_transition" | "step_metric" |
// "gate_waiting" | "error", data: <the engine's payload> }.
export interface RunEvent {
  type: string;
  data?: unknown;
}

export interface LaunchInput {
  target: string;
  taskType: "sim" | "burn";
  prompt: string;
}

export const TERMINAL_STATUSES = new Set([
  "applied",
  "push_rejected",
  "merge_conflict",
  "blocked_secrets",
  "scrubbed",
  "failed",
  "done",
]);

export function isTerminal(status: string | undefined | null): boolean {
  return !!status && TERMINAL_STATUSES.has(status);
}
