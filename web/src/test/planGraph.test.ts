import { describe, expect, it } from "vitest";

import { buildPlanGraph, toneForStatus } from "../plan/planGraph";
import type { Waypoint } from "../plan/types";

describe("buildPlanGraph", () => {
  it("lays out a route as a left-to-right chain with consecutive edges", () => {
    const route: (string | Waypoint)[] = [
      "Scaffold the service",
      { title: "Build the API", phase: "CONSTRUCTION", criteria: ["Create returns 201", "List is paginated"] },
      { title: "Ship it", phase: "CONSTRUCTION" },
    ];
    const g = buildPlanGraph(route);

    expect(g.nodes.map((n) => n.level)).toEqual([0, 1, 2]);
    expect(g.nodes.every((n) => n.row === 0)).toBe(true);
    expect(g.cols).toBe(3);
    expect(g.rows).toBe(1);
    expect(g.edges).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ]);
  });

  it("captures each unit's title, phase, and criteria count", () => {
    const g = buildPlanGraph([{ title: "Build the API", phase: "CONSTRUCTION", criteria: ["a", "b"] }, "Bare unit"]);
    expect(g.nodes[0]).toMatchObject({ index: 0, title: "Build the API", phase: "CONSTRUCTION", criteriaCount: 2 });
    expect(g.nodes[1]).toMatchObject({ index: 1, title: "Bare unit", phase: "", criteriaCount: 0 });
  });

  it("returns an empty graph for an empty route", () => {
    const g = buildPlanGraph([]);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g).toMatchObject({ cols: 0, rows: 0 });
  });
});

describe("toneForStatus", () => {
  it("maps run status to a node tone matching the route list vocabulary", () => {
    expect(toneForStatus(undefined)).toBe("idle");
    expect(toneForStatus("awaiting_gate")).toBe("gate");
    expect(toneForStatus("applied")).toBe("good");
    expect(toneForStatus("done")).toBe("good");
    expect(toneForStatus("failed")).toBe("bad");
    expect(toneForStatus("merge_conflict")).toBe("bad");
    expect(toneForStatus("running")).toBe("live");
  });
});
