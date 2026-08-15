import { describe, expect, it } from "vitest";

import { planToMarkdown, planFromMarkdown, planKey, planSlug, newPlan } from "../plan/persist";
import { planOwnerFromIdToken } from "../plan/identity";
import { SAMPLE_PLANS } from "../plan/sample";
import type { Contributor } from "../plan/types";

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
