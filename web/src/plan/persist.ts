// Persist a FlightPlan as a note in the git vault. The plan is stored as a fenced
// `homebase-plan` JSON block (the authoritative state) under a human-readable header,
// so the same file reads sensibly in the Vault view AND round-trips losslessly here.
// Because it is a vault note, it inherits versioning + "Edited by" attribution and
// the git conflict policy for free.

import type { Contributor, FlightPlan } from "./types";

const PLAN_FENCE = "homebase-plan";
const PLAN_BLOCK = new RegExp("```" + PLAN_FENCE + "\\s*\\n([\\s\\S]*?)\\n```");

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function planSlug(plan: Pick<FlightPlan, "id" | "title">): string {
  const base = slugify(plan.id || "") || slugify(plan.title || "");
  return base || "untitled-plan";
}

export function planKey(plan: Pick<FlightPlan, "id" | "title">): string {
  return `plans/${planSlug(plan)}.md`;
}

// Front-matter values are cosmetic (the JSON block is authoritative); quote them so
// a colon or hash in a title can't break the vault's front-matter parse.
function yaml(value: string): string {
  return JSON.stringify(String(value ?? ""));
}

export function planToMarkdown(plan: FlightPlan): string {
  const frontMatter = [
    "---",
    `title: ${yaml(plan.title)}`,
    `project: ${yaml(plan.project)}`,
    `status: ${plan.status}`,
    `owner: ${yaml(plan.owner?.name ?? "")}`,
    `updatedAt: ${yaml(plan.updatedAt)}`,
    "---",
  ].join("\n");

  const body = [
    `# ${plan.title}`,
    "",
    plan.objective ? `**Objective:** ${plan.objective}` : "",
    "",
    plan.context || "",
    "",
    "<!-- Flight Planner state (source of truth). Managed in the Plan view. -->",
    "```" + PLAN_FENCE,
    JSON.stringify(plan, null, 2),
    "```",
    "",
  ].join("\n");

  return `${frontMatter}\n\n${body}`;
}

// Parse a plan back out of a note. Returns null for a note that is not a plan (no
// block) or whose block is corrupt, so a stray note under plans/ is simply skipped.
export function planFromMarkdown(markdown: string): FlightPlan | null {
  const match = PLAN_BLOCK.exec(markdown || "");
  if (!match) return null;
  try {
    const obj = JSON.parse(match[1]);
    if (obj && typeof obj.id === "string" && typeof obj.title === "string" && Array.isArray(obj.criteria)) {
      return obj as FlightPlan;
    }
  } catch {
    /* corrupt block: treat as not-a-plan */
  }
  return null;
}

// A blank plan to seed a new flight plan, owned by whoever created it.
export function newPlan(title: string, owner: Contributor, at: string): FlightPlan {
  const trimmed = title.trim() || "Untitled plan";
  return {
    id: slugify(trimmed) || "untitled-plan",
    title: trimmed,
    project: "",
    status: "draft",
    owner,
    contributors: [owner],
    objective: "",
    context: "",
    criteria: [],
    sources: [],
    route: [],
    risks: [],
    updatedAt: at,
  };
}
