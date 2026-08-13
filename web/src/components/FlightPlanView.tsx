import { useMemo, useRef, useState } from "react";

import { pendingCount, readyToClear, type FlightPlan, type PlanStatus } from "../plan/types";
import { resolvePlanSources } from "../plan/corpus";
import { AcCard, type GateAction } from "./AcCard";
import { PlanSources } from "./PlanSources";

const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "draft",
  in_review: "in review",
  cleared: "cleared",
  in_flight: "in flight",
  landed: "landed",
};

function Copilot({
  plan,
  onCritique,
  onOpenSource,
}: {
  plan: FlightPlan;
  onCritique: () => void;
  onOpenSource: (slug: string) => void;
}) {
  const gap = pendingCount(plan) === 0 && !readyToClear(plan);
  const ref = (slug: string) => (
    <button type="button" className="ac-link linkable" onClick={() => onOpenSource(slug)}>
      [[{slug}]]
    </button>
  );
  return (
    <aside className="copilot" aria-label="Planning copilot">
      <div className="copilot-head">
        <span className="copilot-mark" aria-hidden="true">
          ✈
        </span>
        Planning copilot
        <span className="copilot-tag">vault-grounded</span>
      </div>
      <div className="copilot-chips">
        <button type="button" className="copilot-chip">Draft ACs for the objective</button>
        <button type="button" className="copilot-chip" onClick={onCritique}>
          What&apos;s missing?
        </button>
        <button type="button" className="copilot-chip">Find related ADRs</button>
      </div>
      <div className="copilot-msg">
        <p>
          I grounded on {ref("identity")}, {ref("retrieval")}, and {ref("review-gate")}. The plan has no
          criterion covering the <strong>rejection path</strong> or a review SLA
          {gap ? "" : " — and a couple are still awaiting review"}.
        </p>
        <button type="button" className="vault-btn" onClick={onCritique}>
          Draft it as a proposal →
        </button>
      </div>
    </aside>
  );
}

export function FlightPlanView({
  plan,
  onBack,
  onGate,
  onFileClearance,
  onCritique,
}: {
  plan: FlightPlan;
  onBack: () => void;
  onGate: (id: string, action: GateAction) => void;
  onFileClearance: () => void;
  onCritique: () => void;
}) {
  const criteriaRef = useRef<HTMLDivElement>(null);
  const sources = useMemo(() => resolvePlanSources(plan), [plan]);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const sections = [
    { id: "objective", label: "Objective" },
    { id: "context", label: "Context" },
    { id: "criteria", label: "Criteria" },
    { id: "sources", label: "Sources" },
    { id: "route", label: "Route" },
    { id: "risks", label: "Risks" },
  ];
  const jump = (id: string) => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const pend = pendingCount(plan);

  // Clicking a [[link]] scrolls to that source card and briefly highlights it.
  const openSource = (slug: string) => {
    setHighlighted(slug);
    document.getElementById(`src-${slug}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setHighlighted((cur) => (cur === slug ? null : cur)), 1600);
  };

  return (
    <div className="flightplan">
      <header className="fp-head">
        <button type="button" className="link-button" onClick={onBack}>
          ← Flight plans
        </button>
        <div className="fp-title-wrap">
          <h1>{plan.title}</h1>
          <span className={`fp-status status-${plan.status}`}>{STATUS_LABEL[plan.status]}</span>
        </div>
        <div className="fp-head-right">
          <span className="fp-contribs">
            {plan.contributors.map((c) => (
              <span key={c.id} className={`fp-contrib ${c.kind}`}>
                {c.name}
              </span>
            ))}
          </span>
          <button
            type="button"
            className="vault-btn primary"
            disabled={plan.status !== "in_review" && plan.status !== "draft"}
            onClick={onFileClearance}
          >
            File clearance ▸
          </button>
        </div>
      </header>

      <div className="fp-body">
        <nav className="fp-outline" aria-label="Plan outline">
          {sections.map((s) => (
            <button key={s.id} type="button" className="fp-outline-item" onClick={() => jump(s.id)}>
              {s.label}
              {s.id === "criteria" && pend > 0 && <span className="fp-outline-badge">{pend}</span>}
            </button>
          ))}
        </nav>

        <main className="fp-main">
          <section id="sec-objective" className="fp-section">
            <h2>Objective</h2>
            <p className="fp-prose">{plan.objective}</p>
          </section>

          <section id="sec-context" className="fp-section">
            <h2>Context &amp; constraints</h2>
            <p className="fp-prose">{plan.context}</p>
          </section>

          <section id="sec-criteria" className="fp-section" ref={criteriaRef}>
            <div className="fp-section-head">
              <h2>Acceptance criteria</h2>
              {pend > 0 && <span className="fp-proposed">{pend} awaiting review</span>}
            </div>
            <div className="ac-list">
              {plan.criteria.map((ac) => (
                <AcCard key={ac.id} ac={ac} onGate={onGate} onOpenSource={openSource} />
              ))}
            </div>
          </section>

          <section id="sec-sources" className="fp-section">
            <div className="fp-section-head">
              <h2>Sources</h2>
              <span className="fp-proposed src-count">{sources.length} from the vault</span>
            </div>
            <p className="fp-prose fp-muted src-intro">Corpus knowledge this plan is grounded on (via get_context).</p>
            <PlanSources sources={sources} highlighted={highlighted} onOpen={openSource} />
          </section>

          <section id="sec-route" className="fp-section">
            <h2>Route</h2>
            <ol className="fp-route">
              {plan.route.map((wp, i) => (
                <li key={i}>{wp}</li>
              ))}
            </ol>
          </section>

          <section id="sec-risks" className="fp-section">
            <h2>Risks</h2>
            {plan.risks.length === 0 ? (
              <p className="fp-prose fp-muted">None recorded.</p>
            ) : (
              <ul className="fp-risks">
                {plan.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </section>
        </main>

        <Copilot plan={plan} onCritique={onCritique} onOpenSource={openSource} />
      </div>
    </div>
  );
}
