import { useEffect, useMemo, useRef, useState } from "react";

import { pendingCount, waypointCriteria, waypointPhase, waypointTitle, type FlightPlan, type PlanStatus, type Waypoint } from "../plan/types";
import { resolvePlanSources, type VaultDoc } from "../plan/corpus";
import type { Run } from "../missions/types";
import { AcCard, type GateAction } from "./AcCard";
import type { AcExecution } from "../plan/review";
import { PlanSources } from "./PlanSources";
import { PlanGraph } from "./PlanGraph";

const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "draft",
  in_review: "in review",
  cleared: "cleared",
  in_flight: "in flight",
  landed: "landed",
};

// A route unit: its title + phase badge + Launch, and (when editable) an expandable
// editor for the unit's OWN acceptance criteria. Manages only its expand state; the
// criteria themselves live on the plan and persist through onSetCriteria.
// Class for a flight's status chip on a route unit (mirrors the Mission deck's colors).
function runStatusClass(status: string): string {
  if (status === "awaiting_gate") return "fp-run gate";
  if (["failed", "scrubbed", "merge_conflict", "push_rejected", "blocked_secrets"].includes(status)) return "fp-run bad";
  if (status === "applied" || status === "done") return "fp-run good";
  return "fp-run live";
}

function RouteUnit({
  wp,
  index,
  target,
  onLaunch,
  status,
  onViewRun,
  onSetCriteria,
}: {
  wp: string | Waypoint;
  index: number;
  target?: string;
  onLaunch?: (wp: string | Waypoint) => void;
  status?: { status: string; runId: string };
  onViewRun?: (runId: string) => void;
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
          {status && (
            <button
              type="button"
              className={runStatusClass(status.status)}
              onClick={() => onViewRun?.(status.runId)}
              title="View this flight in Mission Control"
            >
              {status.status.replace(/_/g, " ")}
            </button>
          )}
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
  onAddSource,
  onSetTarget,
  onLaunchUnit,
  unitStatus,
  flights,
  onViewRun,
  acExecution,
  onReviewFlight,
  reviewCount,
  onSetUnitCriteria,
  onDelete,
  copilot,
}: {
  plan: FlightPlan;
  catalog: Record<string, VaultDoc>;
  onBack: () => void;
  onGate: (id: string, action: GateAction) => void;
  onFileClearance: () => void;
  onAddSource: () => void;
  onSetTarget?: (target: string) => void;
  onLaunchUnit?: (wp: string | Waypoint) => void;
  // The unit's last Mission Control flight + its current status (running / awaiting_gate
  // / failed / applied / ...), so the Route shows that a unit was executed and how it went.
  unitStatus?: (unitTitle: string) => { status: string; runId: string } | undefined;
  // All Mission Control runs for this plan's target repo (its flights), shown so the plan
  // surfaces real MC results/status. Present only in the workspace view with a target.
  flights?: Run[];
  onViewRun?: (runId: string) => void;
  // Each criterion's Mission Control execution status (accomplished / in flight / needs
  // review), derived from the plan's review run. Absent in the store-less dev preview.
  acExecution?: (ac: FlightPlan["criteria"][number]) => AcExecution | undefined;
  // Start the guided review of the criteria a burn flagged; absent when nothing is flagged.
  onReviewFlight?: () => void;
  // How many criteria the guided review will step through (shown on its trigger).
  reviewCount?: number;
  onSetUnitCriteria?: (index: number, criteria: string[]) => void;
  onDelete?: () => void;
  // The planning copilot, docked beside the plan (side-by-side). Injected by the
  // parent so this view stays presentational; absent in the store-less dev preview.
  copilot?: React.ReactNode;
}) {
  const criteriaRef = useRef<HTMLDivElement>(null);
  const [routeView, setRouteView] = useState<"graph" | "list">("graph");
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
          {onDelete && (
            <button type="button" className="vault-btn danger" onClick={onDelete} title="Delete this flight plan">
              Delete
            </button>
          )}
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
              {onReviewFlight && (
                <button type="button" className="fp-review-flight" onClick={onReviewFlight}>
                  Review flight{reviewCount ? ` (${reviewCount})` : ""}
                </button>
              )}
            </div>
            <div className="ac-list">
              {plan.criteria.map((ac) => (
                <AcCard key={ac.id} ac={ac} onGate={onGate} onOpenSource={openSource} execution={acExecution?.(ac)} />
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
            <div className="fp-section-head">
              <h2>Route</h2>
              {plan.route.length > 0 && (
                <div className="fp-route-toggle" role="group" aria-label="Route view">
                  <button type="button" className={routeView === "graph" ? "active" : ""} onClick={() => setRouteView("graph")}>
                    Graph
                  </button>
                  <button type="button" className={routeView === "list" ? "active" : ""} onClick={() => setRouteView("list")}>
                    List
                  </button>
                </div>
              )}
            </div>
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
            {routeView === "graph" ? (
              <PlanGraph
                route={plan.route}
                target={plan.target}
                unitStatus={unitStatus}
                onLaunchUnit={onLaunchUnit}
                onViewRun={onViewRun}
              />
            ) : (
              <ol className="fp-route">
                {plan.route.map((wp, i) => (
                  <RouteUnit
                    key={i}
                    wp={wp}
                    index={i}
                    target={plan.target}
                    onLaunch={onLaunchUnit}
                    status={unitStatus?.(waypointTitle(wp))}
                    onViewRun={onViewRun}
                    onSetCriteria={onSetUnitCriteria}
                  />
                ))}
              </ol>
            )}

            {flights && flights.length > 0 && (
              <div className="fp-flights">
                <div className="fp-flights-head">
                  <span>Flights</span>
                  <span className="fp-flights-count">
                    {flights.length} run{flights.length === 1 ? "" : "s"} on this repo
                  </span>
                </div>
                <ul className="fp-flights-list">
                  {flights.map((r) => {
                    const gradeNum = r.evaluation?.acceptance?.score;
                    return (
                      <li key={r.run_id}>
                        <button
                          type="button"
                          className="fp-flight"
                          onClick={() => onViewRun?.(r.run_id)}
                          title="Open this flight in Mission Control"
                        >
                          <span className="fp-flight-subject">{r.subject || r.run_id}</span>
                          <span className={runStatusClass(r.status)}>{r.status.replace(/_/g, " ")}</span>
                          {typeof gradeNum === "number" && <span className="fp-flight-grade">grade {gradeNum.toFixed(2)}</span>}
                          {typeof r.cost_usd === "number" && <span className="fp-flight-cost">${r.cost_usd.toFixed(4)}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
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

        {copilot}
      </div>
    </div>
  );
}
