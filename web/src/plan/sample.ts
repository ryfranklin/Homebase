// Sample flight plans for the dev-only prototype (?preview=plan). No backend.

import type { Contributor, FlightPlan } from "./types";

const ryan: Contributor = { id: "u-ryan", name: "ryan", kind: "human" };
const alice: Contributor = { id: "u-alice", name: "alice", kind: "human" };
const bobAgent: Contributor = { id: "a-bob", name: "bob·agent", kind: "agent" };
const archAgent: Contributor = { id: "a-arch", name: "architect·agent", kind: "agent" };

export const SAMPLE_PLANS: FlightPlan[] = [
  {
    id: "fp-relay",
    title: "Homebase MCP relay",
    project: "homebase",
    status: "in_review",
    owner: ryan,
    contributors: [ryan, alice, bobAgent, archAgent],
    objective:
      "Expose Homebase as an MCP server so engineers' agents ground themselves in the vault and post proposals into shared per-project threads, removing Ryan as the human message bus.",
    context:
      "Reuses the AgentCore Gateway and the Cognito JWT authorizer. The vault (git) is authoritative; the KB is the derived grounding index behind get_context. See [[project_mission_control]] and [[identity]].",
    criteria: [
      {
        id: "AC-1",
        statement: "Engineer agents authenticate to the relay via a Cognito JWT (machine-to-machine client).",
        status: "approved",
        author: alice,
        rationale: "Reuses the existing authorizer; each engineer gets a distinct principal for attribution.",
        links: ["identity"],
        comments: [],
      },
      {
        id: "AC-2",
        statement: "get_context returns ADRs and acceptance criteria ranked and scoped to the requested project.",
        status: "proposed",
        author: bobAgent,
        rationale: "Grounding must be project-scoped or agents pull irrelevant context.",
        links: ["retrieval", "adr-002-retrieval-store"],
        comments: [{ author: ryan, text: "Scope by a project metadata filter on the KB.", at: "2026-08-14T10:02:00Z" }],
      },
      {
        id: "AC-3",
        statement:
          "propose(project, artifact) writes the agent's proposal into a per-project thread in a 'proposed' state; it never writes directly to the plan of record.",
        status: "proposed",
        author: archAgent,
        rationale: "The review gate is human; agents propose, they do not commit.",
        links: ["review-gate"],
        comments: [],
      },
      {
        id: "AC-4",
        statement: "log_decision(project, ...) appends an approved decision to the vault Logbook as a git commit.",
        status: "approved",
        author: ryan,
        links: ["logbook"],
        comments: [],
      },
      {
        id: "AC-5",
        statement: "Every MCP tool description states the propose-don't-write rule and the review-gate contract to the caller.",
        status: "needs_revision",
        author: alice,
        rationale: "Calling agents only know the rules from the tool contract; make it explicit.",
        links: [],
        comments: [{ author: ryan, text: "Add the rejection path to the contract too.", at: "2026-08-14T10:20:00Z" }],
      },
      {
        id: "AC-6",
        statement: "A non-fast-forward push retries pull-rebase; a true conflict writes a *.conflict.md and surfaces it, never overwriting.",
        status: "proposed",
        author: bobAgent,
        links: ["sync-policy"],
        comments: [],
      },
    ],
    sources: [
      "cf-relay-design",
      "adr-002-retrieval-store",
      "identity",
      "retrieval",
      "review-gate",
      "sync-policy",
      "logbook",
      "project_mission_control",
    ],
    route: [
      "Verify AgentCore Gateway can expose our tools to external callers",
      "Define the MCP tool schemas + contracts",
      "Wire get_context to the KB with project scoping",
      "Thread store + review-gate state machine",
      "Slack notification on new proposals",
    ],
    risks: [
      "Gateway may not support the inbound 'agents call us' shape — spike first.",
      "Concurrent writes from multiple agents need the conflict policy proven under load.",
    ],
    updatedAt: "2026-08-14T10:24:00Z",
  },
  {
    id: "fp-sync",
    title: "Vault sync daemon",
    project: "homebase",
    status: "in_review",
    owner: alice,
    contributors: [alice, ryan],
    objective: "A homebase sync client that keeps a local folder in sync with the git-backed vault for offline and local-editor workflows.",
    context: "Phase 2 of the native sync layer. See [[homebase-sync]].",
    criteria: [
      { id: "AC-1", statement: "Pulls /changes since a cursor and applies deltas locally.", status: "approved", author: alice, links: ["changes-api"], comments: [] },
      { id: "AC-2", statement: "Conditional writes with If-Match reject stale updates (409).", status: "approved", author: alice, links: [], comments: [] },
      { id: "AC-3", statement: "Conflicts produce a conflict copy, never a silent overwrite.", status: "proposed", author: ryan, links: ["sync-policy"], comments: [] },
    ],
    sources: ["changes-api", "sync-policy"],
    route: ["Manifest + changes endpoints", "Local watcher", "Conditional write path"],
    risks: ["Cross-device clock skew on cursors."],
    updatedAt: "2026-08-14T09:10:00Z",
  },
  {
    id: "fp-rate",
    title: "Connector rate limiting",
    project: "homebase",
    status: "cleared",
    owner: ryan,
    contributors: [ryan],
    objective: "Bound outbound connector calls so a runaway tool loop can't exhaust a vendor quota.",
    context: "Grounded in [[connectors]].",
    criteria: [
      { id: "AC-1", statement: "Per-connector token bucket enforced in the shim.", status: "approved", author: ryan, links: ["connectors"], comments: [] },
      { id: "AC-2", statement: "A 429 from a vendor backs off and surfaces a clear tool error.", status: "approved", author: ryan, links: [], comments: [] },
    ],
    sources: ["connectors"],
    route: ["Token bucket", "Backoff", "Error surface"],
    risks: [],
    updatedAt: "2026-08-13T18:00:00Z",
  },
  {
    id: "fp-eval",
    title: "Retrieval eval harness",
    project: "homebase",
    status: "in_flight",
    owner: { id: "u-bob", name: "bob", kind: "human" },
    contributors: [{ id: "u-bob", name: "bob", kind: "human" }],
    objective: "An offline regression gate for retrieval quality.",
    context: "Now executing in Mission Control.",
    criteria: [
      { id: "AC-1", statement: "Gate fails the build when hit_rate@5 drops below threshold.", status: "approved", author: { id: "u-bob", name: "bob", kind: "human" }, links: ["eval-gate"], comments: [] },
    ],
    sources: ["eval-gate"],
    route: ["Fixtures", "Gate"],
    risks: [],
    updatedAt: "2026-08-12T12:00:00Z",
  },
];
