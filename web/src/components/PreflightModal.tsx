import { activeCriteria, approvedCount, pendingCount, readyToClear, type FlightPlan } from "../plan/types";

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`preflight-item ${ok ? "ok" : "warn"}`}>
      <span className="preflight-mark" aria-hidden="true">
        {ok ? "✓" : "⚠"}
      </span>
      {children}
    </li>
  );
}

export function PreflightModal({
  plan,
  onClear,
  onClose,
}: {
  plan: FlightPlan;
  onClear: () => void;
  onClose: () => void;
}) {
  const active = activeCriteria(plan);
  const ready = readyToClear(plan);
  const pend = pendingCount(plan);
  return (
    <div className="preflight-overlay" role="dialog" aria-label="Pre-flight checklist" onClick={onClose}>
      <div className="preflight" onClick={(e) => e.stopPropagation()}>
        <div className="preflight-head">
          <h3>Pre-flight — {plan.title}</h3>
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </div>
        <ul className="preflight-list">
          <Check ok={active.length > 0 && pend === 0}>
            Acceptance criteria approved
            <span className="preflight-count">
              {approvedCount(plan)} / {active.length}
            </span>
          </Check>
          <Check ok={plan.objective.trim().length > 0}>Objective &amp; context complete</Check>
          <Check ok>Risks acknowledged<span className="preflight-count">{plan.risks.length}</span></Check>
          {pend > 0 && <Check ok={false}>{pend} criterion pending review</Check>}
        </ul>
        <div className="preflight-foot">
          <span className="preflight-signoff">
            Sign-off <strong>{plan.owner.name}</strong>
          </span>
          <button type="button" className="vault-btn primary" disabled={!ready} onClick={onClear}>
            Clear for execution ▸
          </button>
        </div>
        <p className="preflight-note">Freezes a versioned artifact and hands off to Mission Control · Pre-Flight.</p>
      </div>
    </div>
  );
}
