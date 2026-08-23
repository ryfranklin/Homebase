// Tie a plan's acceptance criteria to Mission Control's verification, so the plan shows
// whether each AC was accomplished, is still in flight, or needs human review — and so a
// guided review can drive the run's go/no-go gate from those per-criterion verdicts.

import type { AcceptanceCriterion } from "./types";
import type { Run } from "../missions/types";

export type AcExecState = "accomplished" | "in_flight" | "needs_review";

export interface AcExecution {
  state: AcExecState;
  score?: number; // judge score 0..1 when available
  rationale?: string; // the judge's reason (what to look at) when available
}

// The run most relevant to reviewing this plan: one paused at the go/no-go gate first
// (its verdict is actionable — you can approve/reject it), else the most recent run that
// carries an evaluation. Runs are assumed newest-first (the list default order).
export function reviewRunFor(runs: Run[]): Run | undefined {
  return runs.find((r) => r.status === "awaiting_gate") ?? runs.find((r) => !!r.evaluation?.acceptance);
}

// One AC's execution status against a run's per-criterion verdicts. MC enriches each
// per_criterion with its `statement`, so we match on that (trimmed). Falls back to the
// run's lifecycle when there is no per-criterion verdict yet. undefined = nothing to show.
export function acExecution(ac: AcceptanceCriterion, run: Run | undefined): AcExecution | undefined {
  if (!run) return undefined;
  const acc = run.evaluation?.acceptance ?? null;
  const threshold = typeof acc?.threshold === "number" ? acc.threshold : 0.7;
  const pc = acc?.per_criterion?.find((c) => (c.statement ?? "").trim() === ac.statement.trim());
  if (pc && typeof pc.score === "number") {
    return pc.score >= threshold
      ? { state: "accomplished", score: pc.score, rationale: pc.reason }
      : { state: "needs_review", score: pc.score, rationale: pc.reason };
  }
  // No judged verdict for this criterion: infer from the run's lifecycle.
  if (run.status === "applied" || run.status === "done") return { state: "accomplished" };
  if (run.status === "running" || run.status === "queued") return { state: "in_flight" };
  if (run.status === "awaiting_gate") return { state: "needs_review" };
  return undefined;
}

export const AC_EXEC_LABEL: Record<AcExecState, string> = {
  accomplished: "accomplished",
  in_flight: "in flight",
  needs_review: "needs review",
};
