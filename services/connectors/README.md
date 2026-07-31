# services/connectors

The six connectors (Gmail, Google Calendar, Google Drive, Slack, QuickBooks, Atlassian) as
read-first, write-gated MCP tools for the Homebase agent.

## The write-gate is the safety core

`gate.py` is the heart of this package. Any write action (send email, post to Slack, create a Jira
issue or QuickBooks invoice, modify a calendar or Drive file) returns a `ConfirmationContract`
instead of executing. Only a re-invocation carrying the matching confirmation token proceeds. Reads
execute directly.

The gate lives at the tool layer, so both front doors inherit it: whether the caller is the GUI or
the SSH CLI, a write is gated. `caller` is recorded for audit only and never changes the decision.

## Read-first, least privilege

`catalog.py` defines each connector's tools. Read tools carry read-only scopes and are the default;
a write tool exists only where a write is genuinely needed and carries the minimal write scope. There
are no blanket scopes.

## Independent credentials, per-tenant

Each connector authenticates independently through AgentCore Identity; Homebase does not reuse any
other app's tokens. `identity.py` resolves a connector's OAuth token for a tenant using a
tenant-namespaced key (`<tenant_id>/<connector>`), matching the memory-actor and JWT tenant scoping,
so the connector layer is not a single-tenant one-way door. No tokens, client ids, or workspace/app
ids appear in code; they are fetched at runtime through the injected identity client.

## Nothing indexed (ADR-004)

Connector data is fetched live per query and is NEVER written into the corpus / S3 Vectors store.
There is no ingest/index tool, and a test guards that the package references no corpus or ingestion
path.

## Shims

`shim.py` is a minimal MCP shim for connectors not natively reachable from the Gateway: it resolves
the tenant token from AgentCore Identity and routes every call through the write gate, delegating the
concrete API call to an injected `api` callable.

## Tests

```bash
cd services/connectors
python -m unittest discover -s tests   # offline: gate, catalog, identity, shim, no-corpus guard
```
