// The vault knowledge a flight plan grounds on. Sources are explicitly selected
// into a plan (plan.sources holds refs); once selected they are snapshotted so the
// Flight Planner owns them. In the real build these are backed by get_context (KB
// retrieval over the git vault) and source-provider plugins (Confluence, uploads).

import type { FlightPlan } from "./types";

export type SourceOrigin = "vault" | "confluence" | "upload" | "drive" | "slack" | "web";
export type DocKind = "ADR" | "decision" | "note" | "spec" | "design";

export interface VaultDoc {
  slug: string;
  title: string;
  path: string;
  kind: DocKind;
  origin: SourceOrigin;
  excerpt: string;
  externalUrl?: string;
}

// The static catalog: vault docs plus Confluence design pages you can pull in.
export const CORPUS: Record<string, VaultDoc> = {
  identity: {
    slug: "identity", title: "Identity & auth", path: "architecture/identity.md", kind: "note", origin: "vault",
    excerpt: "Cognito with Google federation; a CUSTOM_JWT authorizer gates the API and the AgentCore Gateway. M2M clients get distinct principals.",
  },
  retrieval: {
    slug: "retrieval", title: "Retrieval pipeline", path: "architecture/retrieval.md", kind: "note", origin: "vault",
    excerpt: "Bedrock KB on S3 Vectors (semantic) with a Cohere rerank stage. Over-retrieve, then rerank; expose tag / folder / recency filters.",
  },
  "adr-002-retrieval-store": {
    slug: "adr-002-retrieval-store", title: "ADR-002 Retrieval store", path: "data-engineering/adr-002-retrieval-store.md", kind: "decision", origin: "vault",
    excerpt: "Decision: stay on S3 Vectors (semantic + rerank). Live eval hit_rate@5 = 1.0, above the 0.85 threshold.",
  },
  "review-gate": {
    slug: "review-gate", title: "Review gate", path: "homebase/review-gate.md", kind: "note", origin: "vault",
    excerpt: "Human-in-the-loop from day one: agents propose, never commit. proposed -> approved / needs-revision / rejected.",
  },
  logbook: {
    slug: "logbook", title: "Logbook", path: "homebase/logbook.md", kind: "note", origin: "vault",
    excerpt: "Approved decisions and ACs are appended here as git commits, so the record lives in one versioned location.",
  },
  "sync-policy": {
    slug: "sync-policy", title: "Sync conflict policy", path: "homebase/sync-policy.md", kind: "decision", origin: "vault",
    excerpt: "Pull-rebase before write; retry on non-fast-forward; a true conflict writes a *.conflict.md and is surfaced, never overwritten.",
  },
  connectors: {
    slug: "connectors", title: "Connectors", path: "architecture/connectors.md", kind: "note", origin: "vault",
    excerpt: "Read connectors as MCP tools via AgentCore Gateway + Identity. Write actions are gated; each vendor call is bounded.",
  },
  project_mission_control: {
    slug: "project_mission_control", title: "Mission Control", path: "projects/mission-control.md", kind: "spec", origin: "vault",
    excerpt: "Homebase (plan) -> Pre-Flight (inception) -> Autopilot/TruePlane (build) -> Telemetry (observe). Homebase is the ground station.",
  },
  "changes-api": {
    slug: "changes-api", title: "Changes API", path: "homebase/changes-api.md", kind: "spec", origin: "vault",
    excerpt: "GET /changes?since=<cursor> returns ordered deltas; conditional writes use If-Match to reject stale updates.",
  },
  "eval-gate": {
    slug: "eval-gate", title: "Retrieval eval gate", path: "homebase/eval-gate.md", kind: "note", origin: "vault",
    excerpt: "Offline regression gate over committed fixtures; fails the build when hit_rate@5 drops below threshold.",
  },
  // Confluence design pages (source-provider plugin). Not yet pulled into a plan.
  "cf-relay-design": {
    slug: "cf-relay-design", title: "MCP Relay design", path: "", kind: "design", origin: "confluence",
    externalUrl: "https://confluence.example/pages/relay-design",
    excerpt: "Design canvas for the relay: sequence diagrams for agents calling in, the propose flow, and open questions on the gateway.",
  },
  "cf-ticket-workflow": {
    slug: "cf-ticket-workflow", title: "Ticketing workflow", path: "", kind: "design", origin: "confluence",
    externalUrl: "https://confluence.example/pages/ticketing",
    excerpt: "How the team maps epics/stories today, and the fields a materialized ticket should carry.",
  },
  "cf-auth-rfc": {
    slug: "cf-auth-rfc", title: "Engineer auth RFC", path: "", kind: "design", origin: "confluence",
    externalUrl: "https://confluence.example/pages/auth-rfc",
    excerpt: "RFC exploring machine-to-machine auth options for engineer agents; leans Cognito client-credentials.",
  },
};

export function buildCatalog(extra: VaultDoc[] = []): Record<string, VaultDoc> {
  const cat: Record<string, VaultDoc> = { ...CORPUS };
  for (const d of extra) cat[d.slug] = d;
  return cat;
}

export interface PlanSource {
  doc: VaultDoc;
  citedBy: string[]; // AC ids
  inContext: boolean;
  score: number; // stand-in for rerank relevance
}

function extractRefs(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1].split("|")[0].split("#")[0].trim());
  return out;
}

// The plan's selected sources (plan.sources), enriched with which ACs cite each and
// a relevance stand-in, sorted strongest first.
export function resolvePlanSources(plan: FlightPlan, catalog: Record<string, VaultDoc> = CORPUS): PlanSource[] {
  const cites = new Map<string, Set<string>>();
  for (const ac of plan.criteria) {
    for (const slug of ac.links) {
      if (!cites.has(slug)) cites.set(slug, new Set());
      cites.get(slug)!.add(ac.id);
    }
  }
  const contextRefs = new Set(extractRefs(plan.context));
  return plan.sources
    .map((ref) => catalog[ref])
    .filter((doc): doc is VaultDoc => Boolean(doc))
    .map((doc) => {
      const citedBy = [...(cites.get(doc.slug) ?? [])].sort();
      const inContext = contextRefs.has(doc.slug);
      const score = Math.min(0.98, 0.7 + citedBy.length * 0.07 + (inContext ? 0.05 : 0));
      return { doc, citedBy, inContext, score };
    })
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title));
}
