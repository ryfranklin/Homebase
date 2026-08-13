// The vault knowledge a flight plan grounds on. In the real build these come from
// get_context (KB retrieval + rerank over the git vault); here they are sample
// docs so the Sources panel shows what supporting knowledge a plan is built from.

import type { FlightPlan } from "./types";

export type DocKind = "ADR" | "decision" | "note" | "spec";

export interface VaultDoc {
  slug: string;
  title: string;
  path: string;
  kind: DocKind;
  excerpt: string;
}

export const CORPUS: Record<string, VaultDoc> = {
  identity: {
    slug: "identity",
    title: "Identity & auth",
    path: "architecture/identity.md",
    kind: "note",
    excerpt: "Cognito user pool with Google federation; a CUSTOM_JWT authorizer gates the API and the AgentCore Gateway. Machine-to-machine clients get distinct principals.",
  },
  retrieval: {
    slug: "retrieval",
    title: "Retrieval pipeline",
    path: "architecture/retrieval.md",
    kind: "note",
    excerpt: "Bedrock KB on S3 Vectors (semantic) with a Cohere rerank stage. Over-retrieve a dense candidate set, then rerank; expose tag / folder / recency filters.",
  },
  "adr-002-retrieval-store": {
    slug: "adr-002-retrieval-store",
    title: "ADR-002 — Retrieval store",
    path: "data-engineering/adr-002-retrieval-store.md",
    kind: "decision",
    excerpt: "Decision: stay on S3 Vectors (semantic + rerank). Live eval hit_rate@5 = 1.0, above the 0.85 threshold; the OpenSearch fallback was not triggered.",
  },
  "review-gate": {
    slug: "review-gate",
    title: "Review gate",
    path: "homebase/review-gate.md",
    kind: "note",
    excerpt: "Human-in-the-loop from day one: agents propose, they never commit. A proposal moves proposed → approved / needs-revision / rejected; nothing enters the plan of record un-reviewed.",
  },
  logbook: {
    slug: "logbook",
    title: "Logbook",
    path: "homebase/logbook.md",
    kind: "note",
    excerpt: "Approved decisions and ACs are appended here as git commits, so the record of what was decided lives in one versioned location.",
  },
  "sync-policy": {
    slug: "sync-policy",
    title: "Sync conflict policy",
    path: "homebase/sync-policy.md",
    kind: "decision",
    excerpt: "Pull-rebase before write; retry on non-fast-forward; a true conflict writes a *.conflict.md and is surfaced, never silently overwritten.",
  },
  connectors: {
    slug: "connectors",
    title: "Connectors",
    path: "architecture/connectors.md",
    kind: "note",
    excerpt: "Six read connectors exposed as MCP tools via AgentCore Gateway + Identity. Write actions are gated; each vendor call is bounded.",
  },
  project_mission_control: {
    slug: "project_mission_control",
    title: "Mission Control",
    path: "projects/mission-control.md",
    kind: "spec",
    excerpt: "Aviation seam: Homebase (plan) → Pre-Flight (inception) → Autopilot/TruePlane (build) → Telemetry (observe). Homebase is the ground station.",
  },
  "changes-api": {
    slug: "changes-api",
    title: "Changes API",
    path: "homebase/changes-api.md",
    kind: "spec",
    excerpt: "GET /changes?since=<cursor> returns ordered deltas; clients pull only what changed. Conditional writes use If-Match to reject stale updates.",
  },
  "eval-gate": {
    slug: "eval-gate",
    title: "Retrieval eval gate",
    path: "homebase/eval-gate.md",
    kind: "note",
    excerpt: "Offline regression gate over committed synthetic fixtures; fails the build when hit_rate@5 drops below threshold.",
  },
};

function extractRefs(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1].split("|")[0].split("#")[0].trim());
  return out;
}

export interface PlanSource {
  doc: VaultDoc;
  citedBy: string[]; // AC ids
  inContext: boolean;
  score: number; // stand-in for rerank relevance
}

// Aggregate every vault doc the plan's context + acceptance criteria reference,
// with which ACs cite it. Unknown refs are skipped (not in the corpus).
export function resolvePlanSources(plan: FlightPlan): PlanSource[] {
  const cites = new Map<string, Set<string>>();
  for (const ac of plan.criteria) {
    for (const slug of ac.links) {
      if (!cites.has(slug)) cites.set(slug, new Set());
      cites.get(slug)!.add(ac.id);
    }
  }
  const contextRefs = new Set(extractRefs(plan.context));
  const slugs = new Set<string>([...cites.keys(), ...contextRefs]);

  const sources: PlanSource[] = [];
  for (const slug of slugs) {
    const doc = CORPUS[slug];
    if (!doc) continue;
    const citedBy = [...(cites.get(slug) ?? [])].sort();
    const inContext = contextRefs.has(slug);
    const score = Math.min(0.98, 0.7 + citedBy.length * 0.07 + (inContext ? 0.05 : 0));
    sources.push({ doc, citedBy, inContext, score });
  }
  return sources.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));
}
