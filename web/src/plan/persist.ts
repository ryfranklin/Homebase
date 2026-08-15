// Persist a FlightPlan as a note in the git vault. The plan is stored as a fenced
// `homebase-plan` JSON block (the authoritative state) under a human-readable header,
// so the same file reads sensibly in the Vault view AND round-trips losslessly here.
// Because it is a vault note, it inherits versioning + "Edited by" attribution and
// the git conflict policy for free.

import type { AcStatus, Contributor, FlightPlan, Phase, Waypoint } from "./types";

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

// The draft the planning agent emits in a `homebase-plan-draft` block.
export interface PlanDraft {
  title?: string;
  project?: string;
  objective?: string;
  context?: string;
  target?: string;
  criteria?: { statement: string; status?: string; links?: string[] }[];
  route?: (string | { title: string; phase?: string })[];
  sources?: string[];
  risks?: string[];
}

const DRAFT_BLOCK = /```homebase-plan-draft\s*\n([\s\S]*?)\n```/;

// Extract + parse the agent's plan draft from its (possibly streaming) reply text.
export function planDraftFromMarkdown(text: string): PlanDraft | null {
  const m = DRAFT_BLOCK.exec(text || "");
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]);
    return o && typeof o === "object" ? (o as PlanDraft) : null;
  } catch {
    return null;
  }
}

// Reply text with the draft block removed, for display (the block is surfaced as a
// "create plan" card instead of raw JSON in the conversation).
export function stripDraftBlock(text: string): string {
  return (text || "").replace(DRAFT_BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Build a persistable flight plan from an agent draft. Criteria come in as proposals
// authored by the planning agent (the human review gate promotes them).
export function planFromDraft(draft: PlanDraft, owner: Contributor, at: string): FlightPlan {
  const base = newPlan(draft.title || "Untitled plan", owner, at);
  const agent: Contributor = { id: "a-planner", name: "planner·agent", kind: "agent" };
  const criteria = (draft.criteria || []).map((c, i) => ({
    id: `AC-${i + 1}`,
    statement: c.statement,
    status: (c.status === "approved" ? "approved" : "proposed") as AcStatus,
    author: agent,
    links: c.links || [],
    comments: [],
  }));
  // Preserve the units as { title, phase } so a CONSTRUCTION unit launches as a burn
  // and an INCEPTION unit as a sim; bare strings stay strings.
  const route: (string | Waypoint)[] = (draft.route || []).map((r) => {
    if (typeof r === "string") return r;
    const phase: Phase | undefined = r.phase === "INCEPTION" || r.phase === "CONSTRUCTION" ? r.phase : undefined;
    return phase ? { title: r.title, phase } : { title: r.title };
  });
  return {
    ...base,
    project: draft.project || base.project,
    objective: draft.objective || "",
    context: draft.context || "",
    criteria,
    sources: draft.sources || [],
    route,
    risks: draft.risks || [],
    ...(draft.target ? { target: draft.target } : {}),
  };
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
