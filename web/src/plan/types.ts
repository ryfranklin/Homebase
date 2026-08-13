// Flight Planner domain model. A flight plan is a reviewed spec artifact for one
// unit of work: it is authored/gated here and, once cleared, handed to Mission
// Control for execution.

export type PlanStatus = "draft" | "in_review" | "cleared" | "in_flight" | "landed";
export type AcStatus = "proposed" | "approved" | "needs_revision" | "rejected";

export interface Contributor {
  id: string;
  name: string;
  kind: "human" | "agent";
}

export interface AcComment {
  author: Contributor;
  text: string;
  at: string;
}

export interface AcceptanceCriterion {
  id: string; // e.g. "AC-1"
  statement: string;
  status: AcStatus;
  author: Contributor;
  rationale?: string;
  links: string[]; // vault [[refs]] this AC grounds on
  comments: AcComment[];
}

export interface FlightPlan {
  id: string;
  title: string;
  project: string;
  status: PlanStatus;
  owner: Contributor;
  contributors: Contributor[];
  objective: string;
  context: string;
  criteria: AcceptanceCriterion[];
  route: string[]; // waypoints
  risks: string[];
  updatedAt: string;
}

export const AC_APPROVED = (c: AcceptanceCriterion) => c.status === "approved";
export const isTerminalAc = (c: AcceptanceCriterion) => c.status === "approved" || c.status === "rejected";

export function approvedCount(plan: FlightPlan): number {
  return plan.criteria.filter(AC_APPROVED).length;
}
export function activeCriteria(plan: FlightPlan): AcceptanceCriterion[] {
  return plan.criteria.filter((c) => c.status !== "rejected");
}
export function pendingCount(plan: FlightPlan): number {
  return plan.criteria.filter((c) => c.status === "proposed" || c.status === "needs_revision").length;
}
export function readyToClear(plan: FlightPlan): boolean {
  const active = activeCriteria(plan);
  return active.length > 0 && active.every(AC_APPROVED);
}
