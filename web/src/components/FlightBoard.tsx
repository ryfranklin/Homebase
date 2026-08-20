import { useState } from "react";

import { approvedCount, pendingCount, type FlightPlan, type PlanStatus } from "../plan/types";

const STATUS_GLYPH: Record<PlanStatus, string> = {
  draft: "●",
  in_review: "◐",
  cleared: "✓",
  in_flight: "✈",
  landed: "⤓",
};
const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "draft",
  in_review: "in review",
  cleared: "cleared",
  in_flight: "in flight",
  landed: "landed",
};

function nextAction(plan: FlightPlan): string {
  switch (plan.status) {
    case "in_review":
      return pendingCount(plan) > 0 ? "review" : "file clearance";
    case "cleared":
      return "handoff";
    case "in_flight":
      return "Mission Control ↗";
    default:
      return "open";
  }
}

export function FlightBoard({
  plans,
  onOpen,
  creating = false,
  onNew,
  onCreate,
  onCancelNew,
  onDraft,
  onDelete,
}: {
  plans: FlightPlan[];
  onOpen: (id: string) => void;
  creating?: boolean;
  onNew?: () => void;
  onCreate?: (title: string) => void;
  onCancelNew?: () => void;
  onDraft?: () => void;
  onDelete?: (plan: FlightPlan) => void;
}) {
  const needsReview = plans.reduce((n, p) => n + (p.status === "in_review" ? pendingCount(p) : 0), 0);
  const [title, setTitle] = useState("");
  const submit = () => {
    const t = title.trim();
    if (!t || !onCreate) return;
    onCreate(t);
    setTitle("");
  };
  return (
    <div className="flightboard">
      <header className="fb-head">
        <div>
          <h1>Flight plans</h1>
          <p className="fb-sub">Central planning · handed off to Mission Control for execution</p>
        </div>
        <div className="fb-actions">
          {needsReview > 0 && <span className="fb-badge">Needs review · {needsReview}</span>}
          {onDraft && !creating && (
            <button type="button" className="vault-btn" onClick={onDraft}>
              Draft with agent
            </button>
          )}
          {onNew && !creating && (
            <button type="button" className="vault-btn primary" onClick={onNew}>
              + New flight plan
            </button>
          )}
        </div>
      </header>

      {creating && (
        <div className="fb-new">
          <input
            className="fb-new-input"
            autoFocus
            value={title}
            placeholder="New plan title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onCancelNew?.();
            }}
            aria-label="New plan title"
          />
          <button type="button" className="vault-btn primary" onClick={submit} disabled={!title.trim()}>
            Create
          </button>
          <button type="button" className="vault-btn" onClick={onCancelNew}>
            Cancel
          </button>
        </div>
      )}

      {plans.length === 0 && !creating && (
        <p className="fb-empty">No flight plans yet. Create one to start planning.</p>
      )}

      <div className="fb-table" role="table">
        <div className="fb-row fb-labels" role="row">
          <span>Status</span>
          <span>Plan</span>
          <span>Owner</span>
          <span>AC</span>
          <span>Updated</span>
          <span />
        </div>
        {plans.map((p) => {
          const pend = pendingCount(p);
          return (
            <div key={p.id} className="fb-rowwrap" role="row">
              <button type="button" className="fb-row" onClick={() => onOpen(p.id)}>
                <span className={`fb-status status-${p.status}`}>
                  <span className="fb-glyph" aria-hidden="true">
                    {STATUS_GLYPH[p.status]}
                  </span>
                  {STATUS_LABEL[p.status]}
                </span>
                <span className="fb-title">{p.title}</span>
                <span className="fb-owner">{p.owner.name}</span>
                <span className="fb-ac">
                  {approvedCount(p)}/{p.criteria.length}
                  {pend > 0 && <span className="fb-pending" title="pending review">{`•${pend}`}</span>}
                </span>
                <span className="fb-updated">{new Date(p.updatedAt).toLocaleDateString()}</span>
                <span className="fb-next">{nextAction(p)}</span>
              </button>
              {onDelete && (
                <button
                  type="button"
                  className="fb-del"
                  aria-label={`Delete ${p.title}`}
                  title="Delete flight plan"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
