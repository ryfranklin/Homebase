import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { FlightPlanner } from "../plan/FlightPlanner";
import { approvedCount, pendingCount, readyToClear } from "../plan/types";
import { SAMPLE_PLANS } from "../plan/sample";

describe("plan status helpers", () => {
  const relay = SAMPLE_PLANS.find((p) => p.id === "fp-relay")!;
  it("counts approved and pending criteria", () => {
    expect(approvedCount(relay)).toBe(relay.criteria.filter((c) => c.status === "approved").length);
    expect(pendingCount(relay)).toBeGreaterThan(0);
  });
  it("readyToClear only when every active criterion is approved", () => {
    expect(readyToClear(relay)).toBe(false); // has proposed criteria
    const cleared = SAMPLE_PLANS.find((p) => p.id === "fp-rate")!;
    expect(readyToClear(cleared)).toBe(true);
  });
});

describe("FlightPlanner prototype", () => {
  it("shows the board and opens a plan", () => {
    render(<FlightPlanner />);
    expect(screen.getByText("Flight plans")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Homebase MCP relay"));
    expect(screen.getByRole("heading", { level: 2, name: "Acceptance criteria" })).toBeInTheDocument();
  });

  it("approving a proposed AC updates its status", () => {
    render(<FlightPlanner />);
    fireEvent.click(screen.getByText("Homebase MCP relay"));
    // AC-2 is proposed and has a gate; approve it via the first Approve button.
    const approves = screen.getAllByRole("button", { name: "Approve" });
    expect(approves.length).toBeGreaterThan(0);
    fireEvent.click(approves[0]);
    // One fewer proposed criterion should now be awaiting review.
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBe(approves.length - 1);
  });

  it("completeness check proposes a new criterion", () => {
    render(<FlightPlanner />);
    fireEvent.click(screen.getByText("Homebase MCP relay"));
    const before = screen.getAllByRole("button", { name: "Approve" }).length;
    fireEvent.click(screen.getByRole("button", { name: /Draft it as a proposal/ }));
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBe(before + 1);
  });
});
