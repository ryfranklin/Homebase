// Layout for the plan's route as a node graph. Unlike Mission Control's unit DAG (which
// has declared depends_on), a Homebase plan route is an ordered sequence with no explicit
// dependencies, so the honest shape is a left-to-right chain: each unit follows the one
// before it. Kept pure and separate from the renderer so the layout is testable.

import { waypointCriteria, waypointPhase, waypointTitle, type Waypoint } from "./types";

export interface PlanGraphNode {
  index: number; // position in the route (0-based)
  title: string;
  phase: string; // "" when the unit declares no phase
  criteriaCount: number; // the unit's own definition-of-done size
  level: number; // column — position along the chain
  row: number; // row within the column (always 0 for a linear route)
}

export interface PlanGraphEdge {
  from: number; // route index the edge starts at
  to: number; // route index it points to
}

export interface PlanGraph {
  nodes: PlanGraphNode[];
  edges: PlanGraphEdge[];
  cols: number; // number of columns (= node count for a linear route)
  rows: number; // widest column's row count
}

// Lay out the route as a left-to-right chain: level = position, one row, an edge between
// each consecutive pair. An empty route yields an empty graph.
export function buildPlanGraph(route: (string | Waypoint)[]): PlanGraph {
  const nodes: PlanGraphNode[] = route.map((wp, i) => ({
    index: i,
    title: waypointTitle(wp),
    phase: waypointPhase(wp) ?? "",
    criteriaCount: (waypointCriteria(wp) ?? []).length,
    level: i,
    row: 0,
  }));
  const edges: PlanGraphEdge[] = nodes.slice(1).map((n) => ({ from: n.index - 1, to: n.index }));
  return { nodes, edges, cols: nodes.length, rows: nodes.length ? 1 : 0 };
}

export type GraphTone = "good" | "bad" | "gate" | "live" | "idle";

// Map a Mission Control run status to a node tone. `undefined` (the unit was never
// launched) is idle. Mirrors FlightPlanView.runStatusClass so the graph and the route
// list speak the same status vocabulary.
export function toneForStatus(status?: string): GraphTone {
  if (!status) return "idle";
  if (status === "awaiting_gate") return "gate";
  if (["failed", "scrubbed", "merge_conflict", "push_rejected", "blocked_secrets"].includes(status)) return "bad";
  if (status === "applied" || status === "done") return "good";
  return "live";
}

// Edge stroke colors (hex, since SVG stroke attributes do not reliably read CSS vars).
export const TONE_HEX: Record<GraphTone, string> = {
  good: "#6ee7a8",
  bad: "#ff8b84",
  gate: "#e0a83a",
  live: "#9a9a9e",
  idle: "rgba(255, 255, 255, 0.18)",
};
