import { useState } from "react";

import { activeCriteria, approvedCount, pendingCount, readyToClear, type FlightPlan } from "../plan/types";
import type { MaterializeResult } from "../plan/materialize";
import { openConnectorConsent } from "../connectors/openConsent";
import { MaterializePreview } from "./MaterializePreview";

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
  onMaterialize,
}: {
  plan: FlightPlan;
  onClear: () => void;
  onClose: () => void;
  onMaterialize?: () => Promise<MaterializeResult>;
}) {
  const active = activeCriteria(plan);
  const ready = readyToClear(plan);
  const pend = pendingCount(plan);
  const already = plan.materialized?.find((m) => m.target === "jira");
  const [mz, setMz] = useState<MaterializeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materialize = async () => {
    if (!onMaterialize || busy) return;
    setBusy(true);
    setError(null);
    try {
      setMz(await onMaterialize());
    } catch (e) {
      setError(e instanceof Error ? e.message : "materialize failed");
    } finally {
      setBusy(false);
    }
  };

  const result = mz ?? (already ? { project: already.project, epic: already.epic, stories: already.stories } : null);
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

        <div className="preflight-materialize">
          <span className="preflight-mz-label">On clearance, Mission Control creates:</span>
          <MaterializePreview plan={plan} />
        </div>

        {onMaterialize && (
          <div className="preflight-jira">
            {result?.requires_authorization ? (
              // Re-consent in a SEPARATE window so the pre-flight modal and plan stay
              // put; after linking, the user just clicks Materialize again.
              <button
                type="button"
                className="vault-btn"
                onClick={() => openConnectorConsent(result.authorization_url ?? "")}
              >
                Link Atlassian to materialize
              </button>
            ) : result?.epic ? (
              <div className="preflight-jira-result">
                Created <strong>{result.epic}</strong>
                {result.stories && result.stories.length > 0 && <span> + {result.stories.length} stories</span>}
                {result.project && <span className="preflight-count">{result.project}</span>}
              </div>
            ) : (
              <button type="button" className="vault-btn" disabled={busy} onClick={() => void materialize()}>
                {busy ? "Creating in Jira…" : already ? "Re-materialize to Jira" : "Materialize to Jira"}
              </button>
            )}
            {error && <span className="preflight-jira-error">{error}</span>}
          </div>
        )}

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
