import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PlanGraph } from "../components/PlanGraph";
import type { Waypoint } from "../plan/types";

const ROUTE: (string | Waypoint)[] = [
  { title: "Build the API", phase: "CONSTRUCTION", criteria: ["Create returns 201"] },
  { title: "Ship it", phase: "CONSTRUCTION" },
];

describe("PlanGraph", () => {
  it("renders a node per route unit with its status glyph", () => {
    const unitStatus = (t: string) => (t === "Build the API" ? { status: "applied", runId: "r1" } : undefined);
    render(<PlanGraph route={ROUTE} target="git@github.com:acme/app.git" unitStatus={unitStatus} />);

    expect(screen.getByText("Build the API")).toBeTruthy();
    expect(screen.getByText("Ship it")).toBeTruthy();
    // The launched unit carries its status; the un-launched one does not.
    expect(screen.getByText("applied")).toBeTruthy();
  });

  it("opens a detail panel on click, exposing launch and view-flight actions", () => {
    const onLaunchUnit = vi.fn();
    const onViewRun = vi.fn();
    const unitStatus = (t: string) => (t === "Build the API" ? { status: "awaiting_gate", runId: "r1" } : undefined);
    render(
      <PlanGraph route={ROUTE} target="git@github.com:acme/app.git" unitStatus={unitStatus} onLaunchUnit={onLaunchUnit} onViewRun={onViewRun} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Build the API/ }));

    expect(screen.getByRole("dialog", { name: "Unit 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View flight ↗" }));
    expect(onViewRun).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByRole("button", { name: "Launch ↗" }));
    expect(onLaunchUnit).toHaveBeenCalledWith(ROUTE[0]);
  });

  it("shows an empty-state message when the route has no units", () => {
    render(<PlanGraph route={[]} />);
    expect(screen.getByText(/No route units yet/)).toBeTruthy();
  });
});
