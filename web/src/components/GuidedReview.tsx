import { useMemo, useState } from "react";

import type { AcceptanceCriterion } from "../plan/types";
import type { Run, RunChanges } from "../missions/types";
import { AC_EXEC_LABEL, type AcExecution } from "../plan/review";
import { DiffView } from "./MissionControl";

type Verdict = "ok" | "fix";

// A step-through review of the criteria a burn flagged. Each step shows one criterion,
// the judge's score and rationale (what to look at), and the diff the burn produced, then
// collects a per-criterion verdict (looks right / needs fix). The aggregate drives the
// run's go/no-go gate: any "needs fix" recommends reject, all "looks right" recommends
// approve. The reviewer still makes the final call.
export function GuidedReview({
  run,
  criteria,
  execFor,
  changes,
  loadingChanges,
  onDecide,
  onClose,
}: {
  run: Run;
  criteria: AcceptanceCriterion[];
  execFor: (ac: AcceptanceCriterion) => AcExecution | undefined;
  changes: RunChanges | null;
  loadingChanges: boolean;
  onDecide: (decision: "approve" | "reject") => Promise<void>;
  onClose: () => void;
}) {
  const total = criteria.length;
  const [step, setStep] = useState(0);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atSummary = step >= total;
  const current = atSummary ? null : criteria[step];
  const reviewedAll = criteria.every((c) => verdicts[c.id]);
  const anyFix = criteria.some((c) => verdicts[c.id] === "fix");
  const gateable = run.status === "awaiting_gate";

  const record = (id: string, v: Verdict) => {
    setVerdicts((prev) => ({ ...prev, [id]: v }));
    setStep((s) => Math.min(s + 1, total));
  };

  const decide = async (decision: "approve" | "reject") => {
    if (deciding) return;
    setDeciding(true);
    setError(null);
    try {
      await onDecide(decision);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the decision.");
      setDeciding(false);
    }
  };

  const exec = current ? execFor(current) : undefined;
  const patch = useMemo(() => changes?.patch ?? "", [changes]);

  return (
    <div className="gr-overlay" role="dialog" aria-modal="true" aria-label="Guided review">
      <div className="gr-modal">
        <header className="gr-head">
          <div>
            <h2 className="gr-title">Guided review</h2>
            <p className="gr-sub">
              {run.subject || run.run_id} · {total} criteri{total === 1 ? "on" : "a"} to check
            </p>
          </div>
          <button type="button" className="gr-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="gr-progress" aria-hidden="true">
          {criteria.map((c, i) => (
            <span
              key={c.id}
              className={`gr-pip ${verdicts[c.id] ?? ""} ${i === step ? "current" : ""}`}
              title={c.id}
            />
          ))}
        </div>

        <div className="gr-body">
          {current ? (
            <>
              <div className="gr-step">
                <div className="gr-step-head">
                  <span className="gr-step-count">
                    Step {step + 1} of {total}
                  </span>
                  <span className="gr-step-id">{current.id}</span>
                  {exec && (
                    <span className={`ac-exec ${exec.state}`}>
                      {AC_EXEC_LABEL[exec.state]}
                      {typeof exec.score === "number" && ` · ${exec.score.toFixed(2)}`}
                    </span>
                  )}
                </div>
                <p className="gr-statement">{current.statement}</p>
                {exec?.rationale && (
                  <div className="gr-rationale">
                    <span className="gr-rationale-label">Judge rationale</span>
                    <p>{exec.rationale}</p>
                  </div>
                )}
              </div>

              <div className="gr-diff">
                <span className="gr-diff-label">Changes the burn produced</span>
                {loadingChanges ? (
                  <p className="mc-empty">Loading the diff…</p>
                ) : patch ? (
                  <DiffView patch={patch} truncated={changes?.truncated ?? undefined} />
                ) : (
                  <p className="mc-empty">No file changes were recorded for this run.</p>
                )}
              </div>

              <div className="gr-verdict">
                <button
                  type="button"
                  className={`gr-btn ok ${verdicts[current.id] === "ok" ? "picked" : ""}`}
                  onClick={() => record(current.id, "ok")}
                >
                  Looks right
                </button>
                <button
                  type="button"
                  className={`gr-btn fix ${verdicts[current.id] === "fix" ? "picked" : ""}`}
                  onClick={() => record(current.id, "fix")}
                >
                  Needs fix
                </button>
              </div>
            </>
          ) : (
            <div className="gr-summary">
              <h3 className="gr-summary-title">Review summary</h3>
              <ul className="gr-summary-list">
                {criteria.map((c) => (
                  <li key={c.id} className={`gr-summary-item ${verdicts[c.id] ?? "pending"}`}>
                    <span className="gr-summary-mark" aria-hidden="true">
                      {verdicts[c.id] === "ok" ? "✓" : verdicts[c.id] === "fix" ? "⚠" : "•"}
                    </span>
                    <span className="gr-summary-id">{c.id}</span>
                    <span className="gr-summary-stmt">{c.statement}</span>
                  </li>
                ))}
              </ul>
              <p className="gr-reco">
                {!reviewedAll
                  ? "Review every criterion to get a recommendation."
                  : anyFix
                    ? "One or more criteria need a fix. Recommendation: reject this burn."
                    : "Every criterion looks right. Recommendation: approve this burn."}
              </p>
              {!gateable && (
                <p className="gr-note">
                  This burn is {run.status.replace(/_/g, " ")}, not paused at the gate, so there is no decision to record.
                </p>
              )}
              {error && <p className="gr-error">{error}</p>}
            </div>
          )}
        </div>

        <footer className="gr-foot">
          <button type="button" className="gr-nav" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            Back
          </button>
          {!atSummary ? (
            <button type="button" className="gr-nav" onClick={() => setStep((s) => Math.min(total, s + 1))}>
              Skip
            </button>
          ) : (
            <div className="gr-gate">
              <button
                type="button"
                className="gr-btn reject"
                onClick={() => decide("reject")}
                disabled={!gateable || !reviewedAll || deciding}
              >
                Reject run
              </button>
              <button
                type="button"
                className="gr-btn approve"
                onClick={() => decide("approve")}
                disabled={!gateable || !reviewedAll || anyFix || deciding}
              >
                Approve run
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
