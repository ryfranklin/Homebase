# docs/

Project documentation for Homebase.

## Index

- [RUNBOOK.md](./RUNBOOK.md): end-to-end deploy-and-verify runbook (stack apply order).
- [retrieval.md](./retrieval.md): semantic + rerank retrieval on S3 Vectors; the eval decision (ADR-002).
- [connectors.md](./connectors.md): the six live connectors, read-first, write-gated, per-user OAuth.
- [identity.md](./identity.md): Cognito + Google, JWT claims, tenant/user model.
- [secrets.md](./secrets.md): secret handling (by-hand secrets, ARNs, never in state).
- [ssh-access.md](./ssh-access.md) and [workstation.md](./workstation.md): the SSH plane and dev box.
- [eval-gate.md](./eval-gate.md): the retrieval regression gate.
- [flight-plan-schema.md](./flight-plan-schema.md): the open flight-plan contract (Markdown + YAML in git).
- [mission-control-seam.md](./mission-control-seam.md): the Homebase to Mission Control execution seam.
- [confluence-jira-integration.md](./confluence-jira-integration.md): Confluence sources in, Jira materialize out.
- [diagrams.md](./diagrams.md): Mermaid diagrams kept in sync with `architecture.html`.

## Conventions

- Prose style: avoid em dashes; use commas, colons, semicolons, or parentheses.
- Diagrams: use Mermaid embedded in Markdown for in-document diagrams. The canonical architecture
  view is a self-contained `architecture.html` at the repository root (added later); keep it in
  sync with the Mermaid diagrams here.
- No account IDs, ARNs, real domains, or secrets in any document. Use placeholders such as
  `<YOUR_AWS_REGION>`.
