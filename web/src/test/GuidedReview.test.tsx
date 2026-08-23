import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { GuidedReview } from "../components/GuidedReview";
import type { AcceptanceCriterion } from "../plan/types";
import type { Run, RunChanges } from "../missions/types";

const ac = (id: string, statement: string): AcceptanceCriterion => ({
  id,
  statement,
  status: "approved",
  author: { id: "u1", name: "Ryan", kind: "human" },
  links: [],
  comments: [],
});

const RUN: Run = { run_id: "r1", status: "awaiting_gate", subject: "Build the API" };
const CHANGES: RunChanges = { files: [{ path: "api.ts", added: "10", removed: "2" }], patch: "+ added line\n- removed line" };
const CRITERIA = [ac("AC-1", "Create returns 201"), ac("AC-2", "Handles retries")];

function renderReview(onDecide = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(
    <GuidedReview
      run={RUN}
      criteria={CRITERIA}
      execFor={(c) => (c.id === "AC-2" ? { state: "needs_review", score: 0.4, rationale: "no retry path found" } : { state: "accomplished", score: 0.9 })}
      changes={CHANGES}
      loadingChanges={false}
      onDecide={onDecide}
      onClose={onClose}
    />,
  );
  return { onDecide, onClose };
}

describe("GuidedReview", () => {
  it("steps through each criterion showing statement, judge rationale, and the diff", () => {
    renderReview();
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    expect(screen.getByText("Create returns 201")).toBeTruthy();
    expect(screen.getByText(/added line/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));

    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
    expect(screen.getByText("Handles retries")).toBeTruthy();
    expect(screen.getByText("no retry path found")).toBeTruthy();
  });

  it("approves the run when every criterion looks right", async () => {
    const { onDecide, onClose } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));

    // At the summary, approve is enabled and reject present.
    const approve = screen.getByRole("button", { name: "Approve run" });
    expect(approve.hasAttribute("disabled")).toBe(false);
    fireEvent.click(approve);

    await waitFor(() => expect(onDecide).toHaveBeenCalledWith("approve"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("blocks approval and recommends reject when a criterion needs a fix", () => {
    renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    fireEvent.click(screen.getByRole("button", { name: "Needs fix" }));

    expect(screen.getByText(/Recommendation: reject/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve run" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Reject run" }).hasAttribute("disabled")).toBe(false);
  });
});
