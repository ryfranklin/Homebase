import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MissionControl } from "../components/MissionControl";
import type { UseMissions } from "../missions/useMissions";
import type { Run, RunChanges, RunEvent } from "../missions/types";

function fakeMissions(over: Partial<UseMissions> = {}): UseMissions {
  return {
    runs: [],
    selected: null,
    events: [],
    changes: null,
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

  it("shows the diff to review at the gate, so approval is not blind", () => {
    const selected: Run = { run_id: "r1", status: "awaiting_gate", task_type: "burn", target: "repo", cost_usd: 0.12 };
    const changes: RunChanges = {
      message: "apply task burn-1",
      file_count: 1,
      files: [{ path: "mctf/text.py", added: "6", removed: "1" }],
      stat: " mctf/text.py | 7 +++++--",
      patch: "diff --git a/mctf/text.py b/mctf/text.py\n+def slugify(text):\n",
      truncated: false,
    };
    render(<MissionControl missions={fakeMissions({ selected, changes })} />);
    // The changed file + counts are visible, and the gate copy points to the review.
    expect(screen.getByText("mctf/text.py")).toBeInTheDocument();
    expect(screen.getByText("+6")).toBeInTheDocument();
    expect(screen.getByText(/Review the changes above/)).toBeInTheDocument();
    // The full unified diff is revealed on demand, with added lines colored green.
    fireEvent.click(screen.getByRole("button", { name: "View diff" }));
    const added = screen.getByText(/def slugify\(text\)/);
    expect(added).toBeInTheDocument();
    expect(added.className).toContain("mc-diff-add");
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

  it("renders a terminal run's result as markdown, expandable and copyable", async () => {
    const selected: Run = {
      run_id: "r1",
      status: "done",
      cost_usd: 0.0278,
      detail: "## Repository Summary\n\n**mc-smoketest** is a minimal repo.",
    };
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MissionControl missions={fakeMissions({ selected })} />);

    // Markdown, not raw text: the "##" heading becomes a heading and "**bold**" strong.
    expect(await screen.findByRole("heading", { name: "Repository Summary" })).toBeInTheDocument();
    expect(screen.getByText("mc-smoketest").tagName).toBe("STRONG");

    // Copy hands the full raw markdown to the clipboard.
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(selected.detail);

    // Expand toggles the panel open (no clipping) and back.
    const expand = screen.getByRole("button", { name: "Expand" });
    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
  });
});
