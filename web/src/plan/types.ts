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

export type Phase = "INCEPTION" | "CONSTRUCTION";

// A unit of work in the plan's route. Persisted plans and the sample data use bare
// title strings; the agent draft (and launch) use { title, phase }, so consumers
// accept both via waypointTitle / waypointPhase.
export interface Waypoint {
  title: string;
  phase?: Phase;
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
  sources: string[]; // refs into the corpus catalog (see plan/corpus.ts)
  route: (string | Waypoint)[]; // waypoints (string titles or { title, phase })
  risks: string[];
  target?: string; // the git repo Mission Control builds against (for launching units)
  updatedAt: string;
}

export function waypointTitle(wp: string | Waypoint): string {
  return typeof wp === "string" ? wp : wp.title;
}
export function waypointPhase(wp: string | Waypoint): Phase | undefined {
  return typeof wp === "string" ? undefined : wp.phase;
}

// Preview of the work a materializer would create from a cleared plan (schema:
// epic = plan, stories = waypoints (fallback ACs), ACs = definition of done).
export interface MaterializedStory {
  key: string; // WP-1 / AC-1
  title: string;
}
export interface MaterializePreview {
  epic: string;
  stories: MaterializedStory[];
  definitionOfDone: string[]; // approved AC statements
}

export function materializePreview(plan: FlightPlan): MaterializePreview {
  const approved = plan.criteria.filter(AC_APPROVED);
  const stories: MaterializedStory[] =
    plan.route.length > 0
      ? plan.route.map((wp, i) => ({ key: `WP-${i + 1}`, title: waypointTitle(wp) }))
      : approved.map((ac) => ({ key: ac.id, title: ac.statement }));
  return {
    epic: plan.title,
    stories,
    definitionOfDone: approved.map((ac) => ac.statement),
  };
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
