import { describe, expect, it } from "vitest";

import {
  planToMarkdown,
  planFromMarkdown,
  planKey,
  planChatKey,
  planSlug,
  newPlan,
  planDraftFromMarkdown,
  planFromDraft,
  stripDraftBlock,
  mergeDraftIntoPlan,
  chatToMarkdown,
  chatFromMarkdown,
} from "../plan/persist";
import { planOwnerFromIdToken } from "../plan/identity";
import { SAMPLE_PLANS } from "../plan/sample";
import type { ChatMessage, Contributor } from "../plan/types";

const owner: Contributor = { id: "u1", name: "Ryan Franklin", kind: "human" };

describe("plan persistence", () => {
  it("round-trips a plan through markdown losslessly", () => {
    const plan = SAMPLE_PLANS[0];
    const md = planToMarkdown(plan);
    const back = planFromMarkdown(md);
    expect(back).toEqual(plan);
  });

  it("embeds a human-readable header alongside the state block", () => {
    const md = planToMarkdown(SAMPLE_PLANS[0]);
    expect(md).toMatch(/^---\n/); // front matter
    expect(md).toContain(`# ${SAMPLE_PLANS[0].title}`);
    expect(md).toContain("```homebase-plan");
  });

  it("returns null for a note that is not a plan", () => {
    expect(planFromMarkdown("# just a note\n\nsome text")).toBeNull();
    expect(planFromMarkdown("```homebase-plan\n{ not json ]\n```")).toBeNull();
    expect(planFromMarkdown("")).toBeNull();
  });

  it("keys a plan under plans/ by a stable slug", () => {
    expect(planSlug({ id: "", title: "My New Plan!" })).toBe("my-new-plan");
    expect(planKey({ id: "fp-relay", title: "x" })).toBe("plans/fp-relay.md");
  });

  it("newPlan seeds a draft owned by the creator", () => {
    const p = newPlan("Ship the relay", owner, "2026-08-14T00:00:00Z");
    expect(p.status).toBe("draft");
    expect(p.owner).toEqual(owner);
    expect(p.id).toBe("ship-the-relay");
    expect(p.criteria).toEqual([]);
    // and it survives a round-trip
    expect(planFromMarkdown(planToMarkdown(p))).toEqual(p);
  });
});

describe("agent plan drafts", () => {
  const reply = [
    "Here's a plan for the MCP relay.",
    "",
    "```homebase-plan-draft",
    JSON.stringify({
      title: "MCP relay",
      objective: "Expose Homebase over MCP.",
      criteria: [{ statement: "Engineers authenticate via JWT.", status: "proposed", links: ["identity"] }],
      route: [
        { title: "Investigate the gateway", phase: "INCEPTION" },
        { title: "Build the tool schemas", phase: "CONSTRUCTION" },
      ],
      sources: ["identity"],
      risks: ["gateway shape unknown"],
    }),
    "```",
  ].join("\n");

  it("extracts the draft block and strips it from the displayed text", () => {
    const draft = planDraftFromMarkdown(reply);
    expect(draft?.title).toBe("MCP relay");
    expect(draft?.route?.length).toBe(2);
    const shown = stripDraftBlock(reply);
    expect(shown).toContain("Here's a plan for the MCP relay.");
    expect(shown).not.toContain("homebase-plan-draft");
  });

  it("returns null when there is no draft block yet (mid-stream)", () => {
    expect(planDraftFromMarkdown("still interviewing, no block yet")).toBeNull();
  });

  it("builds a persistable plan from a draft (criteria are proposals by the agent)", () => {
    const draft = planDraftFromMarkdown(reply)!;
    const plan = planFromDraft(draft, owner, "2026-08-15T00:00:00Z");
    expect(plan.title).toBe("MCP relay");
    expect(plan.status).toBe("draft");
    expect(plan.criteria[0]).toMatchObject({ id: "AC-1", status: "proposed", author: { kind: "agent" } });
    // Units keep their phase so a CONSTRUCTION unit launches as a burn, INCEPTION as sim.
    expect(plan.route).toEqual([
      { title: "Investigate the gateway", phase: "INCEPTION" },
      { title: "Build the tool schemas", phase: "CONSTRUCTION" },
    ]);
    // round-trips through the vault format
    expect(planFromMarkdown(planToMarkdown(plan))).toEqual(plan);
  });

  it("preserves a unit's own acceptance criteria from the draft and round-trips them", () => {
    const draftReply = [
      "```homebase-plan-draft",
      JSON.stringify({
        title: "CRUD service",
        route: [
          { title: "Build the API", phase: "CONSTRUCTION", criteria: ["Create returns 201", "Missing id returns 404"] },
          { title: "Investigate schema", phase: "INCEPTION" }, // no unit criteria → inherits the plan DoD
          "Plain string unit", // bare string stays a string, carries no criteria
        ],
      }),
      "```",
    ].join("\n");
    const plan = planFromDraft(planDraftFromMarkdown(draftReply)!, owner, "2026-08-15T00:00:00Z");
    expect(plan.route).toEqual([
      { title: "Build the API", phase: "CONSTRUCTION", criteria: ["Create returns 201", "Missing id returns 404"] },
      { title: "Investigate schema", phase: "INCEPTION" },
      "Plain string unit",
    ]);
    // the per-unit criteria survive the vault (JSON block) round-trip
    expect(planFromMarkdown(planToMarkdown(plan))).toEqual(plan);
  });
});

describe("mergeDraftIntoPlan (revise, non-destructive)", () => {
  // A plan with a mix of reviewed criteria: one approved, one still proposed.
  const base = () => {
    const p = newPlan("Ship the relay", owner, "2026-08-15T00:00:00Z");
    return {
      ...p,
      objective: "old objective",
      criteria: [
        { id: "AC-1", statement: "Engineers authenticate via JWT.", status: "approved" as const, author: owner, links: [], comments: [] },
        { id: "AC-2", statement: "Rate limit is enforced.", status: "proposed" as const, author: owner, links: [], comments: [] },
      ],
      sources: ["identity"],
      risks: ["old risk"],
    };
  };

  it("preserves an approved criterion (matched by statement) and its status", () => {
    const draft = {
      objective: "new objective",
      criteria: [
        { statement: "Engineers authenticate via JWT.", status: "proposed" as const }, // same statement, re-emitted
        { statement: "Audit log records every write.", status: "proposed" as const }, // brand new
      ],
    };
    const merged = mergeDraftIntoPlan(base(), draft, "2026-08-16T00:00:00Z");
    const ac1 = merged.criteria.find((c) => c.statement === "Engineers authenticate via JWT.")!;
    expect(ac1.status).toBe("approved"); // NOT reset to proposed
    expect(ac1.id).toBe("AC-1"); // identity preserved so the review gate keeps tracking it
    // The new one is appended as a fresh proposal with a fresh id.
    const added = merged.criteria.find((c) => c.statement === "Audit log records every write.")!;
    expect(added).toMatchObject({ id: "AC-3", status: "proposed" });
    expect(merged.objective).toBe("new objective"); // scalar fields update from the draft
  });

  it("never drops an existing criterion the draft omitted (deletion stays a human action)", () => {
    const draft = { criteria: [{ statement: "Audit log records every write." }] };
    const merged = mergeDraftIntoPlan(base(), draft, "2026-08-16T00:00:00Z");
    expect(merged.criteria.map((c) => c.id)).toEqual(["AC-1", "AC-2", "AC-3"]);
  });

  it("matches criteria case/whitespace-insensitively so a re-emit does not duplicate", () => {
    const draft = { criteria: [{ statement: "  engineers authenticate via JWT.  " }] };
    const merged = mergeDraftIntoPlan(base(), draft, "2026-08-16T00:00:00Z");
    expect(merged.criteria.length).toBe(2); // no duplicate added
  });

  it("unions sources and keeps existing objective when the draft omits it", () => {
    const merged = mergeDraftIntoPlan(base(), { sources: ["retrieval"] }, "2026-08-16T00:00:00Z");
    expect(merged.sources.sort()).toEqual(["identity", "retrieval"]);
    expect(merged.objective).toBe("old objective");
    expect(merged.risks).toEqual(["old risk"]); // empty draft risks keep the plan's
  });

  it("produces a plan that still round-trips through the vault format", () => {
    const merged = mergeDraftIntoPlan(base(), { criteria: [{ statement: "New one" }] }, "2026-08-16T00:00:00Z");
    expect(planFromMarkdown(planToMarkdown(merged))).toEqual(merged);
  });
});

describe("copilot transcript persistence", () => {
  const messages: ChatMessage[] = [
    { role: "user", author: "Ryan Franklin", text: "Draft a plan for the relay", at: "2026-08-16T00:00:00Z" },
    { role: "agent", author: "planner·agent", text: "Sure — what's the objective?", at: "2026-08-16T00:00:01Z" },
  ];

  it("keys the transcript beside the plan note", () => {
    expect(planChatKey({ id: "fp-relay", title: "x" })).toBe("plans/fp-relay.chat.md");
  });

  it("round-trips the transcript through markdown", () => {
    const md = chatToMarkdown({ title: "Relay" }, messages);
    expect(md).toContain("```homebase-plan-chat");
    expect(md).toContain("# Relay · planning chat");
    expect(chatFromMarkdown(md)).toEqual(messages);
  });

  it("returns [] for a note that is not a transcript", () => {
    expect(chatFromMarkdown("# just a note")).toEqual([]);
    expect(chatFromMarkdown("```homebase-plan-chat\n{ not json ]\n```")).toEqual([]);
  });
});

describe("planOwnerFromIdToken", () => {
  const enc = (obj: Record<string, unknown>) =>
    "h." + btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") + ".s";

  it("prefers name, falls back to email then sub", () => {
    expect(planOwnerFromIdToken(enc({ sub: "s1", name: "Ryan Franklin", email: "r@x.com" }))).toEqual({
      id: "s1",
      name: "Ryan Franklin",
      kind: "human",
    });
    expect(planOwnerFromIdToken(enc({ sub: "s2", email: "r@x.com" }))?.name).toBe("r@x.com");
    expect(planOwnerFromIdToken(enc({ sub: "s3" }))?.name).toBe("s3");
  });

  it("returns undefined for a missing or unparseable token", () => {
    expect(planOwnerFromIdToken(undefined)).toBeUndefined();
    expect(planOwnerFromIdToken("garbage")).toBeUndefined();
  });
});
