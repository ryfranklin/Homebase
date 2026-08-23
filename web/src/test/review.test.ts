import { describe, expect, it } from "vitest";

import { acExecution, reviewRunFor, AC_EXEC_LABEL } from "../plan/review";
import type { AcceptanceCriterion } from "../plan/types";
import type { Run } from "../missions/types";

const ac = (id: string, statement: string): AcceptanceCriterion => ({
  id,
  statement,
  status: "approved",
  author: { id: "u1", name: "Ryan", kind: "human" },
  links: [],
  comments: [],
});

const run = (over: Partial<Run> = {}): Run => ({ run_id: "r1", status: "applied", ...over });

describe("reviewRunFor", () => {
  it("prefers a run paused at the gate", () => {
    const runs = [run({ run_id: "a", status: "applied", evaluation: { acceptance: { score: 1 } } }), run({ run_id: "b", status: "awaiting_gate" })];
    expect(reviewRunFor(runs)?.run_id).toBe("b");
  });

  it("falls back to the most recent run carrying an evaluation", () => {
    const runs = [run({ run_id: "a", status: "running" }), run({ run_id: "b", status: "applied", evaluation: { acceptance: { score: 0.9 } } })];
    expect(reviewRunFor(runs)?.run_id).toBe("b");
  });

  it("returns undefined when no run is reviewable", () => {
    expect(reviewRunFor([run({ status: "running" })])).toBeUndefined();
    expect(reviewRunFor([])).toBeUndefined();
  });
});

describe("acExecution", () => {
  it("marks a criterion accomplished when its judged score clears the threshold", () => {
    const r = run({
      status: "awaiting_gate",
      evaluation: { acceptance: { threshold: 0.7, per_criterion: [{ statement: "Create returns 201", score: 0.9, reason: "verified" }] } },
    });
    const exec = acExecution(ac("AC-1", "Create returns 201"), r);
    expect(exec).toEqual({ state: "accomplished", score: 0.9, rationale: "verified" });
  });

  it("flags a criterion for review when its score is below the threshold, surfacing the reason", () => {
    const r = run({
      status: "awaiting_gate",
      evaluation: { acceptance: { threshold: 0.7, per_criterion: [{ statement: "Handles retries", score: 0.4, reason: "no retry path found" }] } },
    });
    const exec = acExecution(ac("AC-2", "Handles retries"), r);
    expect(exec).toEqual({ state: "needs_review", score: 0.4, rationale: "no retry path found" });
  });

  it("defaults the threshold to 0.7 when none is given", () => {
    const r = run({ status: "awaiting_gate", evaluation: { acceptance: { per_criterion: [{ statement: "X", score: 0.65 }] } } });
    expect(acExecution(ac("AC-3", "X"), r)?.state).toBe("needs_review");
  });

  it("matches on trimmed statement text", () => {
    const r = run({ status: "applied", evaluation: { acceptance: { per_criterion: [{ statement: "  Emits an event  ", score: 0.95 }] } } });
    expect(acExecution(ac("AC-4", "Emits an event"), r)?.state).toBe("accomplished");
  });

  it("infers from the run lifecycle when there is no per-criterion verdict", () => {
    expect(acExecution(ac("AC-5", "z"), run({ status: "running" }))?.state).toBe("in_flight");
    expect(acExecution(ac("AC-5", "z"), run({ status: "queued" }))?.state).toBe("in_flight");
    expect(acExecution(ac("AC-5", "z"), run({ status: "awaiting_gate" }))?.state).toBe("needs_review");
    expect(acExecution(ac("AC-5", "z"), run({ status: "applied" }))?.state).toBe("accomplished");
    expect(acExecution(ac("AC-5", "z"), run({ status: "failed" }))).toBeUndefined();
  });

  it("returns undefined without a run", () => {
    expect(acExecution(ac("AC-6", "y"), undefined)).toBeUndefined();
  });
});

describe("AC_EXEC_LABEL", () => {
  it("gives plain human labels", () => {
    expect(AC_EXEC_LABEL.needs_review).toBe("needs review");
    expect(AC_EXEC_LABEL.in_flight).toBe("in flight");
  });
});
