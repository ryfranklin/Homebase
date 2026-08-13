import { useMemo, useState } from "react";

import { FlightBoard } from "../components/FlightBoard";
import { FlightPlanView } from "../components/FlightPlanView";
import { PreflightModal } from "../components/PreflightModal";
import { AddSourceModal } from "../components/AddSourceModal";
import type { GateAction } from "../components/AcCard";
import { buildCatalog, type VaultDoc } from "./corpus";
import { SAMPLE_PLANS } from "./sample";
import type { AcStatus, FlightPlan } from "./types";

const GATE_TO_STATUS: Record<GateAction, AcStatus> = {
  approve: "approved",
  revise: "needs_revision",
  reject: "rejected",
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Self-contained, backend-free prototype of the Flight Planner: the board, a plan
// with its review gate + copilot + grounded sources, source ingest (vault /
// Confluence / upload / create), and the pre-flight clearance + Jira materialize
// preview. All state is local so every flow is clickable.
export function FlightPlanner() {
  const [plans, setPlans] = useState<FlightPlan[]>(SAMPLE_PLANS);
  const [extraDocs, setExtraDocs] = useState<VaultDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState(false);
  const [adding, setAdding] = useState(false);

  const selected = plans.find((p) => p.id === selectedId) ?? null;
  const catalog = useMemo(() => buildCatalog(extraDocs), [extraDocs]);

  const mutate = (id: string, fn: (p: FlightPlan) => FlightPlan) =>
    setPlans((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));

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

  if (!selected) {
    return <FlightBoard plans={plans} onOpen={setSelectedId} />;
  }
  return (
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
