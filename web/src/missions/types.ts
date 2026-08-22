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
  // The burn's verification/evaluation report (Contrail): deterministic checks + the
  // acceptance-criteria judge scores. Present once Mission Control's verify node has run.
  evaluation?: Evaluation | null;
}

// One acceptance criterion the judge scored (0..1), with its statement + reason.
export interface CriterionScore {
  index?: number;
  statement?: string;
  score?: number;
  weight?: number;
  reason?: string;
}
// A deterministic check the target repo ran (its own tests/build/lint).
export interface VerifyCheck {
  name?: string;
  command?: string;
  exit_code?: number | null;
  duration_s?: number | null;
}
export interface Evaluation {
  checks?: VerifyCheck[];
  acceptance?: {
    score?: number | null; // overall grade 0..1
    threshold?: number | null;
    enforced?: boolean;
    rationale?: string;
    per_criterion?: CriterionScore[];
    error?: string;
  } | null;
}

// A relayed telemetry frame: { type: "node_transition" | "step_metric" |
// "gate_waiting" | "error", data: <the engine's payload> }.
export interface RunEvent {
  type: string;
  data?: unknown;
}

// The diff a burn produced, from GET /runs/<id>/changes. This is what a reviewer
// actually approves at the go/no-go gate: the code the worker wrote, ready to merge.
export interface RunChangeFile {
  path: string;
  added: string; // git numstat count (or "-" for binary)
  removed: string;
}
export interface RunChanges {
  branch?: string | null;
  message?: string | null; // the worker's commit message
  files: RunChangeFile[];
  file_count?: number;
  stat?: string | null; // git --stat summary
  patch?: string | null; // the unified diff (capped by the engine)
  truncated?: boolean;
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
