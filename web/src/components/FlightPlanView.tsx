import { useEffect, useMemo, useRef, useState } from "react";

import { pendingCount, readyToClear, waypointCriteria, waypointPhase, waypointTitle, type FlightPlan, type PlanStatus, type Waypoint } from "../plan/types";
import { resolvePlanSources, type VaultDoc } from "../plan/corpus";
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

// A route unit: its title + phase badge + Launch, and (when editable) an expandable
// editor for the unit's OWN acceptance criteria. Manages only its expand state; the
// criteria themselves live on the plan and persist through onSetCriteria.
function RouteUnit({
  wp,
  index,
  target,
  onLaunch,
  onSetCriteria,
}: {
  wp: string | Waypoint;
  index: number;
  target?: string;
  onLaunch?: (wp: string | Waypoint) => void;
  onSetCriteria?: (index: number, criteria: string[]) => void;
}) {
  const phase = waypointPhase(wp);
  const criteria = waypointCriteria(wp) ?? [];
  const [open, setOpen] = useState(false);
  const count = criteria.length;
  return (
    <li className="fp-wp">
      <div className="fp-wp-head">
        <span className="fp-wp-title">
          {waypointTitle(wp)}
          {phase && <span className={`fp-phase ${phase.toLowerCase()}`}>{phase === "INCEPTION" ? "sim" : "burn"}</span>}
        </span>
        <div className="fp-wp-actions">
          {onSetCriteria && (
            <button
              type="button"
              className={`fp-crit-toggle${count ? " has" : ""}`}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              title="This unit's acceptance criteria (definition of done)"
            >
              {count ? `${count} criteri${count === 1 ? "on" : "a"}` : "acceptance criteria"}
              <span aria-hidden="true"> {open ? "▾" : "▸"}</span>
            </button>
          )}
          {onLaunch && target && (
            <button type="button" className="fp-launch" onClick={() => onLaunch(wp)} title="Launch this unit on Mission Control">
              Launch ↗
            </button>
          )}
        </div>
      </div>
      {onSetCriteria && open && (
        <UnitCriteria criteria={criteria} onChange={(next) => onSetCriteria(index, next)} />
      )}
    </li>
  );
}

// Editor for one unit's acceptance criteria (its definition of done). Edits stay local
// until a blur / add / remove commits the cleaned list upward (one persisted change per
// commit, matching the plan's per-change git model). Empty means the unit inherits the
// plan's approved criteria at launch.
function UnitCriteria({ criteria, onChange }: { criteria: string[]; onChange: (next: string[]) => void }) {
  const [items, setItems] = useState<string[]>(criteria);
  const [draft, setDraft] = useState("");
  // Re-sync when the unit (or plan) changes under us.
  useEffect(() => setItems(criteria), [criteria]);

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const persist = (next: string[]) => {
    const cleaned = next.map((s) => s.trim()).filter(Boolean);
    setItems(cleaned);
    if (!same(cleaned, criteria)) onChange(cleaned);
  };
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    persist([...items, v]);
    setDraft("");
  };

  return (
    <div className="fp-crit">
      <p className="fp-crit-hint">
        This unit&apos;s definition of done. Mission Control judges the build against these; leave empty to
        inherit the plan&apos;s approved criteria.
      </p>
      {items.length > 0 && (
        <ul className="fp-crit-list">
          {items.map((c, i) => (
            <li key={i} className="fp-crit-row">
              <input
                className="fp-crit-input"
                value={c}
                aria-label={`Acceptance criterion ${i + 1}`}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? e.target.value : x)))}
                onBlur={() => persist(items)}
              />
              <button
                type="button"
                className="fp-crit-remove"
                aria-label="Remove criterion"
                onClick={() => persist(items.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="fp-crit-add">
        <input
          className="fp-crit-input"
          value={draft}
          placeholder="Add an acceptance criterion…"
          aria-label="Add an acceptance criterion"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="fp-crit-addbtn" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

export function FlightPlanView({
  plan,
  catalog,
  onBack,
  onGate,
  onFileClearance,
  onCritique,
  onAddSource,
  onSetTarget,
  onLaunchUnit,
  onSetUnitCriteria,
}: {
  plan: FlightPlan;
  catalog: Record<string, VaultDoc>;
  onBack: () => void;
  onGate: (id: string, action: GateAction) => void;
  onFileClearance: () => void;
  onCritique: () => void;
  onAddSource: () => void;
  onSetTarget?: (target: string) => void;
  onLaunchUnit?: (wp: string | Waypoint) => void;
  onSetUnitCriteria?: (index: number, criteria: string[]) => void;
}) {
  const criteriaRef = useRef<HTMLDivElement>(null);
  const sources = useMemo(() => resolvePlanSources(plan, catalog), [plan, catalog]);
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
            <PlanSources sources={sources} highlighted={highlighted} onOpen={openSource} onAddSource={onAddSource} />
          </section>

          <section id="sec-route" className="fp-section">
            <h2>Route</h2>
            {onSetTarget && (
              <div className="fp-target">
                <label>
                  Target repo
                  <input
                    className="fp-target-input"
                    defaultValue={plan.target ?? ""}
                    placeholder="https git url Mission Control builds against"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (plan.target ?? "")) onSetTarget(v);
                    }}
                  />
                </label>
              </div>
            )}
            <ol className="fp-route">
              {plan.route.map((wp, i) => (
                <RouteUnit
                  key={i}
                  wp={wp}
                  index={i}
                  target={plan.target}
                  onLaunch={onLaunchUnit}
                  onSetCriteria={onSetUnitCriteria}
                />
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
