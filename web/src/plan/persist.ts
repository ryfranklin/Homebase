// Persist a FlightPlan as a note in the git vault. The plan is stored as a fenced
// `homebase-plan` JSON block (the authoritative state) under a human-readable header,
// so the same file reads sensibly in the Vault view AND round-trips losslessly here.
// Because it is a vault note, it inherits versioning + "Edited by" attribution and
// the git conflict policy for free.

import type { AcceptanceCriterion, AcStatus, ChatMessage, Contributor, FlightPlan, Phase, Waypoint } from "./types";

const PLAN_FENCE = "homebase-plan";
const PLAN_BLOCK = new RegExp("```" + PLAN_FENCE + "\\s*\\n([\\s\\S]*?)\\n```");

const CHAT_FENCE = "homebase-plan-chat";
const CHAT_BLOCK = new RegExp("```" + CHAT_FENCE + "\\s*\\n([\\s\\S]*?)\\n```");

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

// The copilot transcript lives beside the plan note (plans/<slug>.chat.md), so the
// conversation is versioned + attributed like any vault note and a teammate opening
// the plan can read and resume it. Kept separate from the plan note so a long
// conversation does not churn the plan's own history on every message.
export function planChatKey(plan: Pick<FlightPlan, "id" | "title">): string {
  return `plans/${planSlug(plan)}.chat.md`;
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
  route?: (string | { title: string; phase?: string; criteria?: string[] })[];
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
  return {
    ...base,
    project: draft.project || base.project,
    objective: draft.objective || "",
    context: draft.context || "",
    criteria,
    sources: draft.sources || [],
    route: draftRoute(draft),
    risks: draft.risks || [],
    ...(draft.target ? { target: draft.target } : {}),
  };
}

// Map an agent draft's route (which may mix bare strings and { title, phase, criteria }
// objects) to persisted waypoints, preserving phase and any per-unit acceptance criteria.
function draftRoute(draft: PlanDraft): (string | Waypoint)[] {
  return (draft.route || []).map((r) => {
    if (typeof r === "string") return r;
    const phase: Phase | undefined = r.phase === "INCEPTION" || r.phase === "CONSTRUCTION" ? r.phase : undefined;
    const criteria = Array.isArray(r.criteria) && r.criteria.length ? r.criteria.map(String) : undefined;
    const wp: Waypoint = { title: r.title };
    if (phase) wp.phase = phase;
    if (criteria) wp.criteria = criteria;
    return wp;
  });
}

// Normalize an AC statement for matching a draft criterion against an existing one, so a
// re-emitted plan keeps the reviewed AC (its id, status, comments) instead of resetting it.
function acKey(statement: string): string {
  return statement.trim().replace(/\s+/g, " ").toLowerCase();
}

// Merge a re-emitted agent draft into an existing plan, NON-DESTRUCTIVELY. The revise
// flow sends the agent the current plan and it emits the full updated plan; folding that
// back must never quietly undo human review, so:
//   - acceptance criteria are matched by statement: an existing (possibly approved) AC is
//     preserved as-is; a draft criterion with no match is added as a fresh `proposed`
//     proposal; an existing AC absent from the draft is KEPT (deletion stays a human action).
//   - objective/context/project/target update from the draft only when it provides a value.
//   - route and risks are replaced from the draft (no review state to protect); sources are
//     unioned so a manually-added source is not dropped.
export function mergeDraftIntoPlan(plan: FlightPlan, draft: PlanDraft, at: string): FlightPlan {
  const agent: Contributor = { id: "a-planner", name: "planner·agent", kind: "agent" };
  const existingByKey = new Map(plan.criteria.map((c) => [acKey(c.statement), c]));
  const seen = new Set<string>();

  // Existing criteria first (order preserved), then any genuinely new proposals.
  const merged: AcceptanceCriterion[] = plan.criteria.map((c) => {
    seen.add(acKey(c.statement));
    return c;
  });
  let nextNum = plan.criteria.reduce((n, c) => Math.max(n, parseInt(c.id.replace(/^AC-/, ""), 10) || 0), 0);
  for (const dc of draft.criteria || []) {
    const key = acKey(dc.statement);
    if (!key || existingByKey.has(key) || seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id: `AC-${(nextNum += 1)}`,
      statement: dc.statement,
      status: "proposed",
      author: agent,
      links: dc.links || [],
      comments: [],
    });
  }

  const route = draft.route !== undefined ? draftRoute(draft) : plan.route;
  const sources = Array.from(new Set([...plan.sources, ...(draft.sources || [])]));
  return {
    ...plan,
    project: draft.project || plan.project,
    objective: draft.objective || plan.objective,
    context: draft.context || plan.context,
    criteria: merged,
    route,
    sources,
    risks: draft.risks && draft.risks.length ? draft.risks : plan.risks,
    ...(draft.target ? { target: draft.target } : {}),
    updatedAt: at,
  };
}

// Serialize a copilot transcript as a vault note: a human-readable header over a fenced
// `homebase-plan-chat` JSON block (the authoritative record), mirroring how a plan note
// is stored so it round-trips losslessly and reads sensibly in the Vault view.
export function chatToMarkdown(plan: Pick<FlightPlan, "title">, messages: ChatMessage[]): string {
  const frontMatter = ["---", `title: ${yaml(`${plan.title} · planning chat`)}`, "kind: plan-chat", "---"].join("\n");
  const body = [
    `# ${plan.title} · planning chat`,
    "",
    "<!-- Copilot transcript for this flight plan (source of truth). Managed in the Plan view. -->",
    "```" + CHAT_FENCE,
    JSON.stringify(messages, null, 2),
    "```",
    "",
  ].join("\n");
  return `${frontMatter}\n\n${body}`;
}

// Parse a transcript back out of a chat note. Returns [] for a note that is not a chat
// transcript or whose block is corrupt, so a stray note is simply treated as empty.
export function chatFromMarkdown(markdown: string): ChatMessage[] {
  const match = CHAT_BLOCK.exec(markdown || "");
  if (!match) return [];
  try {
    const obj = JSON.parse(match[1]);
    if (Array.isArray(obj)) return obj.filter((m) => m && typeof m.text === "string") as ChatMessage[];
  } catch {
    /* corrupt block: treat as empty */
  }
  return [];
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
