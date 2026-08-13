import { useState } from "react";

import { FlightBoard } from "../components/FlightBoard";
import { FlightPlanView } from "../components/FlightPlanView";
import { PreflightModal } from "../components/PreflightModal";
import type { GateAction } from "../components/AcCard";
import { SAMPLE_PLANS } from "./sample";
import type { AcStatus, FlightPlan } from "./types";

const GATE_TO_STATUS: Record<GateAction, AcStatus> = {
  approve: "approved",
  revise: "needs_revision",
  reject: "rejected",
};

// Self-contained, backend-free prototype of the Flight Planner: the board, a plan
// with its review gate + copilot, and the pre-flight clearance handoff. All state
// is local so the flows (approve/propose/clear) are clickable.
export function FlightPlanner() {
  const [plans, setPlans] = useState<FlightPlan[]>(SAMPLE_PLANS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState(false);

  const selected = plans.find((p) => p.id === selectedId) ?? null;

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
          statement:
            "A rejected proposal returns a reviewer note and a revised-resubmit path; the relay never silently drops it.",
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
        onBack={() => setSelectedId(null)}
        onGate={onGate}
        onFileClearance={() => setPreflight(true)}
        onCritique={onCritique}
      />
      {preflight && <PreflightModal plan={selected} onClear={onClear} onClose={() => setPreflight(false)} />}
    </>
  );
}
