import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { FlightPlanView } from "../components/FlightPlanView";
import type { FlightPlan } from "../plan/types";

const PLAN: FlightPlan = {
  id: "p1",
  title: "CRUD service",
  project: "app",
  status: "draft",
  owner: { id: "u1", name: "Ryan", kind: "human" },
  contributors: [],
  objective: "",
  context: "",
  criteria: [],
  sources: [],
  route: [{ title: "Build the API", phase: "CONSTRUCTION", criteria: ["Create returns 201"] }],
  risks: [],
  target: "git@github.com:acme/app.git",
  updatedAt: "2026-08-15T00:00:00Z",
};

const noop = () => {};

function renderView(onSetUnitCriteria = vi.fn()) {
  render(
    <FlightPlanView
      plan={PLAN}
      catalog={{}}
      onBack={noop}
      onGate={noop}
      onFileClearance={noop}
      onAddSource={noop}
      onSetUnitCriteria={onSetUnitCriteria}
    />,
  );
  return onSetUnitCriteria;
}

describe("per-unit acceptance criteria editor", () => {
  it("shows the criterion count on the unit and expands the editor", () => {
    renderView();
    const toggle = screen.getByRole("button", { name: /1 criterion/i });
    fireEvent.click(toggle);
    expect(screen.getByDisplayValue("Create returns 201")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/add an acceptance criterion/i)).toBeInTheDocument();
  });

  it("adds a criterion → persists the appended list", () => {
    const spy = renderView();
    fireEvent.click(screen.getByRole("button", { name: /1 criterion/i }));
    fireEvent.change(screen.getByPlaceholderText(/add an acceptance criterion/i), {
      target: { value: "Missing id returns 404" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(spy).toHaveBeenCalledWith(0, ["Create returns 201", "Missing id returns 404"]);
  });

  it("removes a criterion → persists the filtered list", () => {
    const spy = renderView();
    fireEvent.click(screen.getByRole("button", { name: /1 criterion/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove criterion/i }));
    expect(spy).toHaveBeenCalledWith(0, []);
  });

  it("editing a criterion and blurring persists the trimmed statement", () => {
    const spy = renderView();
    fireEvent.click(screen.getByRole("button", { name: /1 criterion/i }));
    const input = screen.getByDisplayValue("Create returns 201");
    fireEvent.change(input, { target: { value: "  Create returns 201 with a Location header  " } });
    fireEvent.blur(input);
    expect(spy).toHaveBeenCalledWith(0, ["Create returns 201 with a Location header"]);
  });

  it("without the editor callback, a unit shows no criteria toggle (read-only view)", () => {
    render(
      <FlightPlanView plan={PLAN} catalog={{}} onBack={noop} onGate={noop} onFileClearance={noop} onAddSource={noop} />,
    );
    // The per-unit toggle (e.g. "1 criterion ▸") is absent; the section-nav "Criteria"
    // tab is a different control and is not asserted here.
    expect(screen.queryByRole("button", { name: /criterion|acceptance criteria/i })).toBeNull();
  });
});
