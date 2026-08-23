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

// One turn in a plan's copilot conversation. The transcript is persisted alongside the
// plan in the vault so it is team-visible and resumable (async collaboration): any
// contributor can open the plan and see how it was reasoned into shape. `author` names
// the human or agent that spoke; `at` is an ISO timestamp.
export interface ChatMessage {
  role: "user" | "agent";
  author: string;
  text: string;
  at: string;
}

export type Phase = "INCEPTION" | "CONSTRUCTION";

// A unit of work in the plan's route. Persisted plans and the sample data use bare
// title strings; the agent draft (and launch) use { title, phase }, so consumers
// accept both via waypointTitle / waypointPhase.
//
// criteria is the unit's OWN definition of done (acceptance-criterion statements). When
// present it scopes what this unit is judged against, overriding the plan-wide approved
// criteria at launch; absent, the unit falls back to the plan's approved criteria. These
// are plain statements: the plan-level `criteria` stay the governed, approval-tracked
// plan contract, while unit criteria are the finer-grained per-unit DoD.
export interface Waypoint {
  title: string;
  phase?: Phase;
  criteria?: string[];
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
  materialized?: Materialization[]; // record of external work created from this plan
  executions?: PlanExecution[]; // Mission Control runs launched from this plan's units
  updatedAt: string;
}

// A run launched from this plan (a Mission Control burn/sim), recorded so the plan shows
// its flights and their outcome. Mirrors `materialized` (a record of external work).
export interface PlanExecution {
  runId: string;
  unitTitle: string;
  taskType?: string; // "sim" | "burn"
  launchedAt: string;
}

// A record of a plan being materialized into an external tracker (Jira epic + stories).
export interface Materialization {
  target: "jira";
  project?: string;
  epic?: string;
  stories: { key: string; title: string }[];
  at: string;
}

export function waypointTitle(wp: string | Waypoint): string {
  return typeof wp === "string" ? wp : wp.title;
}
export function waypointPhase(wp: string | Waypoint): Phase | undefined {
  return typeof wp === "string" ? undefined : wp.phase;
}
// The unit's own acceptance criteria (its definition of done), or undefined when the
// waypoint carries none (a bare-string unit, or one that inherits the plan's DoD).
export function waypointCriteria(wp: string | Waypoint): string[] | undefined {
  if (typeof wp === "string") return undefined;
  return wp.criteria && wp.criteria.length ? wp.criteria : undefined;
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

// The plan lifecycle, in order, so status only ever ADVANCES to reflect real events
// (review an AC -> in_review, launch a unit -> in_flight, a run lands -> landed) and
// never regresses. Returns `target` only when it is strictly ahead of `current`.
const PLAN_STATUS_ORDER: PlanStatus[] = ["draft", "in_review", "cleared", "in_flight", "landed"];
export function advancePlanStatus(current: PlanStatus, target: PlanStatus): PlanStatus {
  return PLAN_STATUS_ORDER.indexOf(target) > PLAN_STATUS_ORDER.indexOf(current) ? target : current;
}
