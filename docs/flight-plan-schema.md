# Flight Plan schema (v1)

The open, plugin-facing contract for a Homebase flight plan. A flight plan is the
compiled, reviewed spec for one unit of work. It is authored in the Flight Planner,
gated by human review, and, once cleared, handed to Mission Control for execution.

This document is the format every plugin, agent, and Mission Control reads and
writes. It is intentionally open: plain Markdown plus documented YAML front matter,
stored in the git vault. There is no proprietary store; anything that can read a
text file and parse YAML can read a flight plan.

## Design principles

- **Open format.** Markdown + YAML front matter in git. Diffable, versioned,
  human and machine readable.
- **Structured where it counts.** The machine-facing data (acceptance criteria,
  sources, waypoints, handoff) lives in front matter so parsers get it
  deterministically. The human narrative (objective, context) lives in the body.
- **Flight Planner is the source of truth.** External design (for example
  Confluence) is an input; when content is selected into a plan it is snapshotted
  into git, so the plan does not rot when the upstream changes.
- **Open on read/propose, governed on commit.** Any plugin may read a plan and
  propose changes; every write becomes a proposal subject to the review gate. Only
  an authorized reviewer promotes a proposal to approved.
- **Forward compatible.** `schema_version` is required; unknown fields are
  preserved on round-trip, never dropped.

## File layout

One plan is one file: `flightplans/<project>/<id>.md`.

```markdown
---
schema_version: 1
kind: flight-plan
id: fp-relay
title: Homebase MCP relay
project: homebase
status: in_review            # draft | in_review | cleared | in_flight | landed
owner: { id: u-ryan, name: ryan, kind: human }
contributors:
  - { id: u-ryan, name: ryan, kind: human }
  - { id: a-bob, name: bob-agent, kind: agent }
created: 2026-08-14T10:00:00Z
updated: 2026-08-14T10:24:00Z

acceptance_criteria:
  - id: AC-1
    statement: Engineer agents authenticate to the relay via a Cognito JWT.
    status: approved         # proposed | approved | needs_revision | rejected
    author: { id: u-alice, name: alice, kind: human }
    rationale: Reuses the existing authorizer; distinct principal per engineer.
    links: [identity]        # source refs this AC grounds on
    satisfied_by: [WP-2]     # waypoint ids that deliver this AC

sources:
  - ref: adr-002-retrieval-store
    origin: vault            # vault | confluence | upload | drive | slack | web
    kind: decision           # ADR | decision | note | spec | design
    title: ADR-002 Retrieval store
    path: data-engineering/adr-002-retrieval-store.md
    external_url: null
    snapshot: true           # a copy is stored in git (Flight Planner owns it)
    selected_by: u-ryan
    selected_at: 2026-08-14T10:05:00Z

route:
  - id: WP-1
    title: Verify AgentCore Gateway can expose our tools to external callers
  - id: WP-2
    title: Define the MCP tool schemas and contracts

risks:
  - Gateway may not support the inbound shape; spike first.

handoff:
  cleared_at: null
  cleared_by: null
  materialized: []           # records of external work created from this plan
---

## Objective

Expose Homebase as an MCP server so engineers' agents ground themselves in the
vault and post proposals into shared per-project threads.

## Context and constraints

Reuses the AgentCore Gateway and the Cognito JWT authorizer. The vault (git) is
authoritative; the KB is the derived grounding index behind get_context.
```

## Field reference

### Plan

| Field | Type | Notes |
|---|---|---|
| `schema_version` | int | Required. This document describes v1. |
| `kind` | string | Always `flight-plan`. |
| `id` | string | Stable id, unique within a project. |
| `title`, `project` | string | |
| `status` | enum | `draft`, `in_review`, `cleared`, `in_flight`, `landed`. |
| `owner`, `contributors` | Actor | See Actor. Agents and humans are distinguishable. |
| `created`, `updated` | ISO 8601 | |
| `acceptance_criteria` | AC[] | The contract. See AC. |
| `sources` | Source[] | The corpus knowledge selected into the plan. See Source. |
| `route` | Waypoint[] | The high level units of work. |
| `risks` | string[] | |
| `handoff` | Handoff | Clearance and materialization record. |

### Actor

`{ id: string, name: string, kind: "human" | "agent" }`. Attribution derives from
this and, in git, from the commit author.

### Acceptance criterion (AC)

| Field | Type | Notes |
|---|---|---|
| `id` | string | For example `AC-1`, unique within the plan. |
| `statement` | string | The testable condition of done. |
| `status` | enum | `proposed`, `approved`, `needs_revision`, `rejected`. |
| `author` | Actor | Who wrote or last revised it. |
| `rationale` | string? | Why it exists. |
| `links` | string[] | `sources[].ref` values this AC grounds on. |
| `satisfied_by` | string[]? | `route[].id` waypoints that deliver this AC. |

Lifecycle: a proposal enters as `proposed`; the review gate moves it to `approved`,
`needs_revision`, or `rejected`. A plan is clearable only when every non-rejected AC
is `approved`.

### Source

The corpus knowledge a plan is grounded on. Sources are selected (not just linked),
and by default snapshotted so the plan is self contained.

| Field | Type | Notes |
|---|---|---|
| `ref` | string | Stable id used by `AC.links`. |
| `origin` | enum | `vault`, `confluence`, `upload`, `drive`, `slack`, `web`. |
| `kind` | enum | `ADR`, `decision`, `note`, `spec`, `design`. |
| `title` | string | |
| `path` | string? | Git path when snapshotted into the vault. |
| `external_url` | string? | Link to the origin (for example the Confluence page). |
| `snapshot` | bool | When true, content is copied into git and the plan owns it. |
| `selected_by`, `selected_at` | Actor id / ISO 8601 | |

### Waypoint

`{ id: string, title: string }`. The unit that becomes a Jira story (see Handoff).

### Handoff

| Field | Type | Notes |
|---|---|---|
| `cleared_at`, `cleared_by` | ISO 8601 / Actor id | Set when the plan is cleared. |
| `materialized` | Materialization[] | One per external target created. |

`Materialization`:
`{ target: "jira" | "github" | "linear", epic: string?, created_at: ISO, created_by: Actor id }`.

## Materialization (plan to work)

When a cleared plan is handed off, a materializer plugin emits external work. The
default mapping, target agnostic:

- **Epic = the plan.** Description = objective + context + a backlink to the plan.
  Acceptance criteria = the plan's ACs (the definition of done).
- **Stories = route waypoints.** Each waypoint becomes a story linked to the epic.
  When a plan has no waypoints, fall back to story per AC.
- **ACs are the gate, not the tasks.** Each AC cross links (`satisfied_by`) to the
  stories that deliver it; the epic cannot close until all ACs are verified.

Traceability runs end to end: ticket -> waypoint -> AC -> source doc.

## Plugin contracts

Connectors are the first plugins. Every plugin is addressable over MCP, and every
write it makes is a proposal through the review gate, never a direct commit.

| Type | Direction | Operations (MCP tools) | First instance |
|---|---|---|---|
| **Source provider** | in | `list(query)`, `fetch(ref)` -> content to snapshot | Confluence connector |
| **Materializer** | out | `preview(plan)`, `materialize(plan, target)` | Jira connector |
| **Validator** | check | `validate(plan)` -> findings (proposed ACs / warnings) | copilot completeness check |
| **Transformer** | reshape | `transform(doc)` -> derived doc (extract, summarize, diagram) | (none yet) |

Rules for all plugins:

- Reads are open. A plugin may read any plan it is authorized for.
- Writes are proposals. A plugin creates ACs or edits with `status: proposed` and
  an `author` of `kind: agent`. A human reviewer promotes them.
- Materializers run only on a `cleared` plan and record a `Materialization`.
- Tool descriptions must state these rules to the calling agent, so an external
  agent learns the propose-do-not-commit contract from the contract itself.

## Governance

The review gate is the single write-safety mechanism for an open, multi-writer,
plugin-extensible system. Humans, agents, and plugins all propose; only an
authorized reviewer (a role, not a person, so it scales to a team) promotes a
proposal to `approved`. Clearance requires every non-rejected AC approved.

## Versioning

`schema_version` is required and starts at 1. A reader that does not recognize a
newer version reads what it can and preserves unknown fields on write. Additive
fields do not bump the major version; a breaking change does, and ships with a
migration note here.
