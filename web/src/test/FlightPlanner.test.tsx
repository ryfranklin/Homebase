import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { FlightPlanner } from "../plan/FlightPlanner";
import { approvedCount, pendingCount, readyToClear } from "../plan/types";
import { SAMPLE_PLANS } from "../plan/sample";
import { resolvePlanSources } from "../plan/corpus";

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

  it("shows the corpus sources the plan is grounded on", () => {
    render(<FlightPlanner />);
    fireEvent.click(screen.getByText("Homebase MCP relay"));
    expect(screen.getByRole("heading", { level: 2, name: "Sources" })).toBeInTheDocument();
    expect(screen.getByText("ADR-002 Retrieval store")).toBeInTheDocument();
    expect(screen.getByText("data-engineering/adr-002-retrieval-store.md")).toBeInTheDocument();
  });

  it("ingests a new source via the Add source picker", () => {
    render(<FlightPlanner />);
    fireEvent.click(screen.getByText("Homebase MCP relay"));
    // The auth RFC (Confluence) is not yet selected into the relay plan.
    expect(screen.queryByText("Engineer auth RFC")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add source" }));
    const dialog = screen.getByRole("dialog", { name: "Add sources" });
    // Add it from the picker.
    const row = screen.getByText("Engineer auth RFC").closest(".src-pick") as HTMLElement;
    fireEvent.click(row.querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(dialog).not.toBeInTheDocument();
    // Now it appears as a plan source.
    expect(screen.getByText("Engineer auth RFC")).toBeInTheDocument();
  });

  it("previews the Jira materialization on the clearance screen", () => {
    render(<FlightPlanner />);
    fireEvent.click(screen.getByText("Homebase MCP relay"));
    fireEvent.click(screen.getByRole("button", { name: /File clearance/ }));
    expect(screen.getByText(/On clearance, Mission Control creates/)).toBeInTheDocument();
    expect(screen.getByText("Epic")).toBeInTheDocument();
    expect(screen.getAllByText("Story").length).toBeGreaterThan(0);
    expect(screen.getByText(/Definition of done/)).toBeInTheDocument();
  });
});

describe("resolvePlanSources", () => {
  const relay = SAMPLE_PLANS.find((p) => p.id === "fp-relay")!;
  it("aggregates cited vault docs with their citing ACs, ranked", () => {
    const sources = resolvePlanSources(relay);
    expect(sources.length).toBeGreaterThan(0);
    const retrieval = sources.find((s) => s.doc.slug === "retrieval")!;
    expect(retrieval.citedBy).toContain("AC-2");
    // context references [[project_mission_control]] even though no AC cites it.
    expect(sources.some((s) => s.doc.slug === "project_mission_control" && s.inContext)).toBe(true);
    // sorted by score descending.
    expect(sources[0].score).toBeGreaterThanOrEqual(sources[sources.length - 1].score);
  });
});
