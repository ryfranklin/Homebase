import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FlightBoard } from "../components/FlightBoard";
import { FlightPlanView } from "../components/FlightPlanView";
import { PreflightModal } from "../components/PreflightModal";
import { AddSourceModal } from "../components/AddSourceModal";
import { PlanCopilot } from "../components/PlanCopilot";
import { ModeSwitch, type AppMode } from "../components/ModeSwitch";
import type { GateAction } from "../components/AcCard";
import { buildCatalog, type VaultDoc } from "./corpus";
import { SAMPLE_PLANS } from "./sample";
import { mergeDraftIntoPlan, newPlan, slugify, type PlanDraft } from "./persist";
import type { PlanStore } from "./store";
import { waypointCriteria, waypointPhase, waypointTitle, type AcStatus, type ChatMessage, type Contributor, type FlightPlan, type Waypoint } from "./types";
import { makeMissionsApi } from "../missions/api";
import { searchConfluence, confluenceToVaultDoc } from "./confluence";
import { materializePlan } from "./materialize";

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
  onOpenSettings,
  store,
  user,
  apiBaseUrl,
  getToken,
}: {
  onNavigate?: (mode: AppMode) => void;
  onSignOut?: () => void;
  onOpenSettings?: () => void;
  store?: PlanStore;
  user?: Contributor;
  apiBaseUrl?: string;
  getToken?: () => Promise<string>;
} = {}) {
  const [plans, setPlans] = useState<FlightPlan[]>(store ? [] : SAMPLE_PLANS);
  const [loading, setLoading] = useState(!!store);
  const [saveError, setSaveError] = useState(false);
  const [extraDocs, setExtraDocs] = useState<VaultDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [drafting, setDrafting] = useState(false);
  // The selected plan's copilot transcript, loaded from the vault so it is team-visible
  // and resumable (async collaboration). Keyed by plan id in `chatFor`.
  const [chatFor, setChatFor] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);

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

  // Load the selected plan's copilot transcript from the vault. The copilot re-seeds
  // when `chatFor` catches up to the open plan, so a team member sees prior turns.
  useEffect(() => {
    if (!selected) {
      setChat([]);
      setChatFor(null);
      return;
    }
    if (!store) {
      // No vault store (dev preview): the copilot still runs, just without persistence.
      setChat([]);
      setChatFor(selected.id);
      return;
    }
    let alive = true;
    setChat([]);
    setChatFor(null);
    store
      .loadChat(selected)
      .then((msgs) => {
        if (!alive) return;
        setChat(msgs);
        setChatFor(selected.id);
      })
      .catch(() => {
        if (!alive) return;
        setChatFor(selected.id); // start a fresh transcript if none loads
      });
    return () => {
      alive = false;
    };
  }, [store, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Fold a copilot re-draft back into the open plan (non-destructive: preserves reviewed
  // acceptance criteria, adds new ones as proposals), then persist the merged plan.
  const onApplyDraft = (d: PlanDraft) => {
    if (!selected) return;
    mutate(selected.id, (p) => mergeDraftIntoPlan(p, d, new Date().toISOString()));
  };

  // Persist the copilot transcript for the open plan (one commit per turn), so the
  // conversation is versioned and any teammate can resume it.
  const onPersistChat = useCallback(
    (msgs: ChatMessage[]) => {
      if (!store || !selected) return;
      setChat(msgs);
      // Clear a stale banner on success so a one-off failure doesn't stick around.
      void store
        .saveChat(selected, msgs)
        .then(() => setSaveError(false))
        .catch(() => setSaveError(true));
    },
    [store, selected],
  );

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

  // Delete a plan: drop it from the board and remove its plans/<id>.md note from the
  // vault. Confirmed by title, since this is destructive. Returns to the board if the
  // deleted plan was open.
  const onDeletePlan = (plan: FlightPlan) => {
    if (!store) return;
    if (!window.confirm(`Delete flight plan "${plan.title}"? This removes it from the vault.`)) return;
    setPlans((prev) => prev.filter((p) => p.id !== plan.id));
    if (selectedId === plan.id) setSelectedId(null);
    setSaveError(false);
    void store.remove(plan).catch(() => setSaveError(true));
  };

  // A plan the agent drafted in the interview: persist and open it.
  const onDraftCreate = (plan: FlightPlan) => {
    if (plansRef.current.some((p) => p.id === plan.id)) plan.id = `${plan.id}-${plansRef.current.length + 1}`;
    setPlans((prev) => [plan, ...prev]);
    savePlan(plan);
    setDrafting(false);
    setSelectedId(plan.id);
  };

  const canDraft = !!(apiBaseUrl && getToken);
  const missionsApi = useMemo(() => (apiBaseUrl && getToken ? makeMissionsApi(apiBaseUrl, getToken) : null), [apiBaseUrl, getToken]);

  // Live status of the runs this plan launched, so the Route shows each unit's last
  // flight and its outcome (running / awaiting gate / failed / applied). Fetched when
  // the open plan (and its executions) changes; keyed by run id.
  const [runStatuses, setRunStatuses] = useState<Record<string, string>>({});
  const execKey = (selected?.executions ?? []).map((e) => e.runId).join(",");
  useEffect(() => {
    const execs = selected?.executions ?? [];
    if (!missionsApi || execs.length === 0) return;
    let live = true;
    const ids = [...new Set(execs.map((e) => e.runId))];
    Promise.all(
      ids.map((id) =>
        missionsApi
          .get(id)
          .then((r) => [id, r.status] as const)
          .catch(() => [id, "unknown"] as const),
      ),
    ).then((pairs) => {
      if (live) setRunStatuses((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      live = false;
    };
  }, [selected?.id, execKey, missionsApi]);

  // The latest recorded flight for a route unit (by title) + its current status.
  const unitStatus = (title: string): { status: string; runId: string } | undefined => {
    const exec = (selected?.executions ?? []).find((e) => e.unitTitle === title);
    if (!exec) return undefined;
    return { status: runStatuses[exec.runId] ?? "…", runId: exec.runId };
  };

  const onSetTarget = (target: string) => {
    if (!selected) return;
    mutate(selected.id, (p) => ({ ...p, target: target || undefined, updatedAt: new Date().toISOString() }));
  };

  // Materialize the cleared plan into Jira (epic + stories); record the keys on it.
  const onMaterialize = async () => {
    const result = await materializePlan(apiBaseUrl!, getToken!, selected);
    if (result.epic && selected) {
      mutate(selected.id, (p) => ({
        ...p,
        materialized: [
          ...(p.materialized || []).filter((m) => m.target !== "jira"),
          { target: "jira", project: result.project, epic: result.epic, stories: result.stories || [], at: new Date().toISOString() },
        ],
        updatedAt: new Date().toISOString(),
      }));
    }
    return result;
  };

  // Edit a route unit's own acceptance criteria (its definition of done), persisting one
  // change per edit. A bare-string unit with no phase and no criteria stays a bare string
  // (minimal churn); otherwise it normalizes to a { title, phase?, criteria? } waypoint.
  const onSetUnitCriteria = (index: number, criteria: string[]) => {
    if (!selected) return;
    mutate(selected.id, (p) => ({
      ...p,
      route: p.route.map((wp, i) => {
        if (i !== index) return wp;
        const title = waypointTitle(wp);
        const phase = waypointPhase(wp);
        if (!phase && criteria.length === 0) return title;
        const next: Waypoint = { title };
        if (phase) next.phase = phase;
        if (criteria.length) next.criteria = criteria;
        return next;
      }),
    }));
  };

  // Launch a plan unit on Mission Control, then jump to the Mission deck to watch it.
  const onLaunchUnit = async (wp: string | Waypoint) => {
    if (!selected || !missionsApi || !selected.target) return;
    const planCtx = {
      target: selected.target,
      title: selected.title,
      objective: selected.objective,
      context: selected.context,
      criteria: selected.criteria,
    };
    try {
      const run = await missionsApi.launchUnit(planCtx, {
        title: waypointTitle(wp),
        phase: waypointPhase(wp),
        criteria: waypointCriteria(wp),
      });
      // Record the run on the plan so it shows its flights (and their outcome) here,
      // not only in the Mission deck. Newest first; the plan note persists it.
      if (run?.run_id) {
        const exec = {
          runId: run.run_id,
          unitTitle: waypointTitle(wp),
          taskType: run.task_type ?? (waypointPhase(wp) === "INCEPTION" ? "sim" : "burn"),
          launchedAt: new Date().toISOString(),
        };
        mutate(selected.id, (p) => ({
          ...p,
          executions: [exec, ...(p.executions ?? [])],
          updatedAt: new Date().toISOString(),
        }));
      }
      onNavigate?.("mission");
    } catch {
      /* the Mission deck surfaces run/launch errors */
    }
  };

  let content: React.ReactNode;
  if (loading) {
    content = <div className="plan-loading">Loading flight plans…</div>;
  } else if (!selected) {
    content = (
      <FlightBoard
        plans={plans}
        onOpen={setSelectedId}
        creating={creating}
        onNew={() => setCreating(true)}
        onCreate={onNewPlan}
        onCancelNew={() => setCreating(false)}
        onDraft={canDraft ? () => setDrafting(true) : undefined}
        onDelete={store ? onDeletePlan : undefined}
      />
    );
  } else {
    content = (
      <>
        <FlightPlanView
          plan={selected}
          catalog={catalog}
          onBack={() => setSelectedId(null)}
          onGate={onGate}
          onFileClearance={() => setPreflight(true)}
          onAddSource={() => setAdding(true)}
          onSetTarget={store ? onSetTarget : undefined}
          onLaunchUnit={missionsApi ? (wp) => void onLaunchUnit(wp) : undefined}
          unitStatus={missionsApi ? unitStatus : undefined}
          onViewRun={missionsApi ? () => onNavigate?.("mission") : undefined}
          onSetUnitCriteria={store ? onSetUnitCriteria : undefined}
          onDelete={store ? () => onDeletePlan(selected) : undefined}
          copilot={
            canDraft && chatFor === selected.id ? (
              <PlanCopilot
                key={selected.id}
                apiBaseUrl={apiBaseUrl!}
                getToken={getToken!}
                owner={owner}
                plan={selected}
                initialMessages={chat}
                onPersist={store ? onPersistChat : undefined}
                onApplyDraft={onApplyDraft}
              />
            ) : undefined
          }
        />
        {preflight && (
          <PreflightModal
            plan={selected}
            onClear={onClear}
            onClose={() => setPreflight(false)}
            onMaterialize={canDraft ? onMaterialize : undefined}
          />
        )}
        {adding && (
          <AddSourceModal
            catalog={Object.values(catalog)}
            selected={selected.sources}
            onAdd={addSource}
            onCreate={onCreate}
            onUpload={onUpload}
            onClose={() => setAdding(false)}
            onConfluenceSearch={canDraft ? (q) => searchConfluence(apiBaseUrl!, getToken!, q) : undefined}
            onAddConfluence={canDraft ? (page) => registerDoc(confluenceToVaultDoc(page)) : undefined}
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
          {onNavigate && <ModeSwitch active="plan" onNavigate={onNavigate} onOpenSettings={onOpenSettings} />}
          {onSignOut && (
            <button type="button" className="link-button" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <div className="plan-body">{content}</div>
      {drafting && canDraft && (
        <PlanCopilot
          variant="modal"
          apiBaseUrl={apiBaseUrl!}
          getToken={getToken!}
          owner={owner}
          onCreatePlan={onDraftCreate}
          onClose={() => setDrafting(false)}
        />
      )}
    </div>
  );
}
