import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FlightBoard } from "../components/FlightBoard";
import { FlightPlanView } from "../components/FlightPlanView";
import { PreflightModal } from "../components/PreflightModal";
import { AddSourceModal } from "../components/AddSourceModal";
import { ModeSwitch, type AppMode } from "../components/ModeSwitch";
import type { GateAction } from "../components/AcCard";
import { buildCatalog, type VaultDoc } from "./corpus";
import { SAMPLE_PLANS } from "./sample";
import { newPlan, slugify } from "./persist";
import type { PlanStore } from "./store";
import type { AcStatus, Contributor, FlightPlan } from "./types";

const GATE_TO_STATUS: Record<GateAction, AcStatus> = {
  approve: "approved",
  revise: "needs_revision",
  reject: "rejected",
};

const DEFAULT_OWNER: Contributor = { id: "you", name: "You", kind: "human" };

// The Flight Planner: the board, a plan with its review gate + copilot + grounded
// sources, source ingest, and the pre-flight clearance + Jira materialize preview.
// When a `store` is provided (the real workspace view), plans are loaded from and
// saved to the git vault, so every change is a versioned, attributed commit and the
// board survives reloads. The dev preview passes no store and stays in-memory with
// SAMPLE_PLANS. It carries the shared nav when mounted as a workspace view.
export function FlightPlanner({
  onNavigate,
  onSignOut,
  store,
  user,
}: {
  onNavigate?: (mode: AppMode) => void;
  onSignOut?: () => void;
  store?: PlanStore;
  user?: Contributor;
} = {}) {
  const [plans, setPlans] = useState<FlightPlan[]>(store ? [] : SAMPLE_PLANS);
  const [loading, setLoading] = useState(!!store);
  const [saveError, setSaveError] = useState(false);
  const [extraDocs, setExtraDocs] = useState<VaultDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);

  const owner = user ?? DEFAULT_OWNER;
  const plansRef = useRef(plans);
  plansRef.current = plans;

  // Load the board from the vault (plans/*.md). Empty until the first plan is created.
  useEffect(() => {
    if (!store) return;
    let alive = true;
    setLoading(true);
    store
      .list()
      .then((ps) => alive && setPlans(ps))
      .catch(() => {
        /* leave the board empty; a save will surface errors */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [store]);

  const selected = plans.find((p) => p.id === selectedId) ?? null;
  const catalog = useMemo(() => buildCatalog(extraDocs), [extraDocs]);

  const savePlan = useCallback(
    (plan: FlightPlan) => {
      if (!store) return;
      setSaveError(false);
      void store.save(plan).catch(() => setSaveError(true));
    },
    [store],
  );

  // Apply a change to a plan and persist it (one commit per change).
  const mutate = (id: string, fn: (p: FlightPlan) => FlightPlan) => {
    const current = plansRef.current.find((p) => p.id === id);
    if (!current) return;
    const updated = fn(current);
    setPlans((prev) => prev.map((p) => (p.id === id ? updated : p)));
    savePlan(updated);
  };

  const onGate = (acId: string, action: GateAction) => {
    if (!selected) return;
    mutate(selected.id, (p) => ({
      ...p,
      criteria: p.criteria.map((c) => (c.id === acId ? { ...c, status: GATE_TO_STATUS[action] } : c)),
      updatedAt: new Date().toISOString(),
    }));
  };

  const onCritique = () => {
    if (!selected) return;
    const nextNum = selected.criteria.length + 1;
    mutate(selected.id, (p) => ({
      ...p,
      criteria: [
        ...p.criteria,
        {
          id: `AC-${nextNum}`,
          statement: "A rejected proposal returns a reviewer note and a revised-resubmit path; the relay never silently drops it.",
          status: "proposed",
          author: { id: "a-copilot", name: "copilot·agent", kind: "agent" },
          rationale: "Surfaced by the completeness check: no criterion covered the rejection path.",
          links: ["review-gate"],
          comments: [],
        },
      ],
      updatedAt: new Date().toISOString(),
    }));
  };

  const addSource = (ref: string) => {
    if (!selected) return;
    mutate(selected.id, (p) => (p.sources.includes(ref) ? p : { ...p, sources: [...p.sources, ref], updatedAt: new Date().toISOString() }));
  };

  const registerDoc = (doc: VaultDoc) => {
    setExtraDocs((prev) => (prev.some((d) => d.slug === doc.slug) ? prev : [...prev, doc]));
    addSource(doc.slug);
  };

  const onCreate = (title: string) =>
    registerDoc({
      slug: `doc-${slugify(title)}`,
      title,
      path: `homebase/${slugify(title)}.md`,
      kind: "note",
      origin: "vault",
      excerpt: "Created in the Flight Planner.",
    });

  const onUpload = (name: string) =>
    registerDoc({
      slug: `up-${slugify(name)}`,
      title: name,
      path: `uploads/${name}`,
      kind: "note",
      origin: "upload",
      excerpt: "Uploaded file (extracted to text on ingest).",
    });

  const onClear = () => {
    if (!selected) return;
    mutate(selected.id, (p) => ({ ...p, status: "cleared", updatedAt: new Date().toISOString() }));
    setPreflight(false);
  };

  const onNewPlan = (title: string) => {
    const plan = newPlan(title, owner, new Date().toISOString());
    // A slug collision with an existing plan would overwrite it; disambiguate.
    if (plansRef.current.some((p) => p.id === plan.id)) plan.id = `${plan.id}-${plansRef.current.length + 1}`;
    setPlans((prev) => [plan, ...prev]);
    savePlan(plan);
    setCreating(false);
    setSelectedId(plan.id);
  };

  let content: React.ReactNode;
  if (loading) {
    content = <div className="plan-loading">Loading flight plans…</div>;
  } else if (!selected) {
    content = <FlightBoard plans={plans} onOpen={setSelectedId} creating={creating} onNew={() => setCreating(true)} onCreate={onNewPlan} onCancelNew={() => setCreating(false)} />;
  } else {
    content = (
      <>
        <FlightPlanView
          plan={selected}
          catalog={catalog}
          onBack={() => setSelectedId(null)}
          onGate={onGate}
          onFileClearance={() => setPreflight(true)}
          onCritique={onCritique}
          onAddSource={() => setAdding(true)}
        />
        {preflight && <PreflightModal plan={selected} onClear={onClear} onClose={() => setPreflight(false)} />}
        {adding && (
          <AddSourceModal
            catalog={Object.values(catalog)}
            selected={selected.sources}
            onAdd={addSource}
            onCreate={onCreate}
            onUpload={onUpload}
            onClose={() => setAdding(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="plan">
      <header className="chat-header">
        <span className="wordmark">
          <span className="wordmark-dot" aria-hidden="true"></span>
          Homebase
        </span>
        <div className="header-actions">
          {saveError && <span className="plan-save-error" title="A change could not be saved to the vault">save failed</span>}
          {onNavigate && <ModeSwitch active="plan" onNavigate={onNavigate} />}
          {onSignOut && (
            <button type="button" className="link-button" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <div className="plan-body">{content}</div>
    </div>
  );
}
