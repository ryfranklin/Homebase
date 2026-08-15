# Confluence and Jira integration plan

Confluence is design **input**; Jira is materialization **output**. Together they
close the flight-plan lifecycle:

```
Confluence design pages ──▶ Flight plan (AI-DLC INCEPTION, agent grounds on them)
                              │  human review gate: criteria approved
                              ▼
                           cleared plan ──▶ Jira epic + stories (materialize)
                              │                     │
                              ▼                     ▼
                     Mission Control runs   traceability: ticket → waypoint → AC → source
```

## What already exists

- **Reads, live.** `confluence.search` (CQL, read-only) and `jira.search_issues`
  (read-only) run through the connector shims with the tenant's vaulted Atlassian
  token (AgentCore Identity). The planning agent already calls them during the
  interview, so a flight plan can ground on Confluence designs and existing Jira
  work today (Step 3).
- **A write tool, gated.** `jira.create_issue` (scope `write:jira-work`) exists in
  the connector catalog. Every write returns a **confirmation contract** first: the
  caller must re-invoke with the confirmation token to actually create the issue.
  That gate is the write-safety mechanism; nothing is created without a deliberate
  confirm.
- **The schema is ready.** The flight-plan schema carries `sources[]` with
  `origin: confluence` and `snapshot: true`, and a `handoff.materialized[]` record
  for external work created from a plan.

## Confluence in (design → plan sources)

Two layers, one already done:

1. **Grounding (done).** The planning agent reads Confluence in the interview
   (`confluence_search`) to build the plan on real designs, not re-decide them.
2. **Sources (to build).** Make a Confluence page a first-class plan source,
   snapshotted into the vault so the plan owns it:
   - Flight Planner "Add source → Confluence" → BFF `GET /api/plan/sources/confluence?q=`
     → the atlassian shim `confluence.search` → a list of pages.
   - Select a page → fetch its content → write it into the vault as a source note
     (through the vault worker, git-committed) → add a `sources[]` entry
     (`origin: confluence`, `snapshot: true`, `path`, `external_url`).
   - **Gap:** `confluence.search` returns results with excerpts, not full page
     bodies. To snapshot faithfully, add a read tool `confluence.get_page(id)`
     (scope already granted: `read:page:confluence`). v1 can snapshot the excerpt
     and link out; v1.1 adds `get_page` for the full body.

## Jira out (cleared plan → epic + stories)

Materialize a **cleared** plan into Jira, recording the result on the plan:

- Trigger: the pre-flight "Materialize to Jira" action (the preview already exists,
  `materializePreview`). The confirm click IS the write-gate confirmation.
- Flow: BFF `POST /api/plan/materialize` (a cleared plan + a target Jira project):
  1. Create the **epic** = the plan (description = objective + context + a backlink
     to the plan note; the approved ACs are the definition of done).
  2. Create a **story per route waypoint** (fallback: per approved AC), each linked
     to the epic.
  3. Each `jira.create_issue` call: first invocation returns a confirmation token;
     re-invoke with the token to create. The BFF drives both hops.
  4. Write `handoff.materialized[]` (target `jira`, epic key, created_at/by) and the
     issue keys back onto the plan note (git-committed), so re-materializing is
     idempotent (guard on the existing record).
- Mapping (target-agnostic, from the schema): **epic = plan**, **stories =
  waypoints** (fallback ACs), **ACs = the gate/DoD**, cross-linked `satisfied_by`.
  Traceability end to end: ticket → waypoint → AC → source doc.
- Identity + safety: writes use the tenant's vaulted Atlassian token; the shim's
  confirmation contract is the human-confirm gate. Writes are **BFF-driven explicit
  actions**, never agent-initiated (the agent holds read tools only).

## Build increments

- **P0 (done):** agent reads Confluence + Jira in the interview (Step 3).
- **P1 — Confluence sources:** the Add-source Confluence tab → search → snapshot into
  the vault → plan source. (Adds a BFF endpoint + a small web surface; reuses the
  atlassian shim and the vault worker.) Optionally add `confluence.get_page`.
- **P2 — Jira materialize:** the materialize action on a cleared plan → epic + stories
  via the gated `jira.create_issue` → record `handoff.materialized[]` + Jira keys.
  (Adds a BFF materialize endpoint + a confirm UI; reuses the atlassian write tool.)

## Open decisions

1. **Confluence full-content:** add `confluence.get_page` (faithful snapshot) now, or
   snapshot the search excerpt + external link for v1?
2. **Jira target:** which project key + epic/story issue-type ids `jira.create_issue`
   should use (per plan, or a configured default)?
3. **Materialize idempotency + updates:** re-materialize should not duplicate; and do
   we sync later plan edits to the created issues, or is materialize a one-way emit?
4. **Where materialize runs:** BFF invokes the atlassian shim directly (like connector
   status) — confirmed the right home, not the agent.
