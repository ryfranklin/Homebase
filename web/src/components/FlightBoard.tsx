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

export function FlightBoard({ plans, onOpen }: { plans: FlightPlan[]; onOpen: (id: string) => void }) {
  const needsReview = plans.reduce((n, p) => n + (p.status === "in_review" ? pendingCount(p) : 0), 0);
  return (
    <div className="flightboard">
      <header className="fb-head">
        <div>
          <h1>Flight plans</h1>
          <p className="fb-sub">Central planning · handed off to Mission Control for execution</p>
        </div>
        <div className="fb-actions">
          {needsReview > 0 && <span className="fb-badge">Needs review · {needsReview}</span>}
          <button type="button" className="vault-btn primary">
            + New flight plan
          </button>
        </div>
      </header>

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
            <button key={p.id} type="button" className="fb-row" role="row" onClick={() => onOpen(p.id)}>
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
          );
        })}
      </div>
    </div>
  );
}
