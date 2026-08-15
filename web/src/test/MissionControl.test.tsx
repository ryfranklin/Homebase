import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MissionControl } from "../components/MissionControl";
import type { UseMissions } from "../missions/useMissions";
import type { Run, RunEvent } from "../missions/types";

function fakeMissions(over: Partial<UseMissions> = {}): UseMissions {
  return {
    runs: [],
    selected: null,
    events: [],
    error: null,
    refresh: vi.fn(async () => {}),
    launch: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
    decide: vi.fn(async () => {}),
    ...over,
  };
}

describe("MissionControl", () => {
  it("launches a run from the form", () => {
    const launch = vi.fn(async () => {});
    render(<MissionControl missions={fakeMissions({ launch })} />);
    fireEvent.change(screen.getByLabelText("Target repo"), { target: { value: "https://github.com/x/y.git" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "investigate" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(launch).toHaveBeenCalledWith({ target: "https://github.com/x/y.git", taskType: "sim", prompt: "investigate" });
  });

  it("shows the go/no-go gate for an awaiting_gate run and drives a decision", () => {
    const decide = vi.fn(async () => {});
    const selected: Run = { run_id: "r1", status: "awaiting_gate", task_type: "burn", target: "repo", cost_usd: 0.12 };
    render(<MissionControl missions={fakeMissions({ selected, decide })} />);
    expect(screen.getByText(/paused at the go\/no-go gate/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    expect(decide).toHaveBeenCalledWith("r1", "approve");
  });

  it("renders telemetry events for the selected run", () => {
    const selected: Run = { run_id: "r1", status: "running", cost_usd: 0.01 };
    const events: RunEvent[] = [
      { type: "node_transition", data: { node: "dispatch" } },
      { type: "step_metric", data: { model: "claude-haiku-4-5", cost_usd: 0.002 } },
    ];
    render(<MissionControl missions={fakeMissions({ selected, events })} />);
    expect(screen.getByText("→ dispatch")).toBeInTheDocument();
    expect(screen.getByText(/claude-haiku-4-5/)).toBeInTheDocument();
  });
});
