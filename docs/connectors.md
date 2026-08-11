# Connectors: the by-hand OAuth setup

Homebase talks to six external systems as read-first, write-gated tools: Gmail, Google Calendar,
Google Drive, Slack, QuickBooks, and Atlassian. Each authenticates INDEPENDENTLY through AgentCore
Identity. The same six systems may exist as Claude.ai integrations elsewhere; Homebase does not borrow
those tokens, and it does not reuse any Mission Control bot credentials. Every connector has its own
credentialed path.

This document is the by-hand OAuth setup you perform once, outside the repo. All identifiers below are
placeholders. Nothing here (client ids, secrets, workspace or app ids, tokens) is committed: client
ids and secrets go into the git-ignored `infra/stacks/connectors/terraform.tfvars`, and AgentCore
Identity stores the secrets.

## Principles

- Read-first: register only read scopes by default. A write scope is added only for the specific
  gated write tool that needs it.
- Write-gated: every write (send, post, create, modify) returns a confirmation contract to the caller
  and executes only on explicit confirmation. This is enforced in `services/connectors`, so both the
  GUI and the SSH CLI inherit it.
- Per-tenant: tokens are namespaced per tenant in AgentCore Identity (`<tenant_id>/<connector>`).
- Nothing indexed: connector data is fetched live per query and never written into the corpus.

## Google (Gmail, Calendar, Drive)

One OAuth client backs all three, with per-target scopes. This is a NEW client, separate from the
Cognito federation client used for user login (P3).

1. In the Google Cloud Console, create an OAuth 2.0 Client ID (type: Web application).
2. Request read scopes only by default:
   - Gmail: `https://www.googleapis.com/auth/gmail.readonly`
   - Calendar: `https://www.googleapis.com/auth/calendar.readonly`
   - Drive: `https://www.googleapis.com/auth/drive.readonly`
   Add a write scope (for example `gmail.send`, `calendar.events`, `drive.file`) only when you enable
   the corresponding gated write tool.
3. Set the authorized redirect URI to the AgentCore Identity callback for your account/region.
4. Put the client id and secret into git-ignored tfvars (`google_client_id`, `google_client_secret`).

## Slack: register a NEW dedicated Homebase app

Per the locked decision, Homebase gets its OWN Slack app in your workspace, with its own scopes and
credentials. It does NOT reuse the Mission Control bot tokens or the Claude.ai Slack integration.

1. At `api.slack.com/apps`, create a new app "Homebase" in your workspace (from scratch).
2. Add read scopes by default: `channels:history`, `groups:history` (and `channels:read` /
   `users:read` as needed for context). Add `chat:write` ONLY to enable the gated post-message tool.
3. Install the app to your workspace to obtain its own OAuth credentials.
4. Put the app's client id and secret into git-ignored tfvars (`slack_client_id`,
   `slack_client_secret`). These belong to the Homebase app alone.

## QuickBooks (Intuit)

1. In the Intuit developer portal, create an app and obtain OAuth 2.0 credentials.
2. Request the read scope `com.intuit.quickbooks.accounting.read` by default; add the write scope
   only to enable the gated invoice-creation tool.
3. Note the OIDC discovery URL for your environment.
4. Put the client id, secret, and discovery URL into git-ignored tfvars.

## Atlassian (Jira / Confluence)

1. In the Atlassian developer console, create an OAuth 2.0 (3LO) app.
2. Request read scopes by default (for example `read:jira-work`, `read:confluence-content.summary`);
   add a write scope (`write:jira-work`) only to enable the gated issue-creation tool.
3. Note the OIDC discovery URL.
4. Put the client id, secret, and discovery URL into git-ignored tfvars.

## After setup

`terraform -chdir=infra/stacks/connectors apply` registers the Gateway, the credential providers, and
the read-first targets. The write-confirmation gate is already enforced in code; enabling a write tool
means adding its scope above and wiring the tool, and it stays gated regardless.

## Consent and the finalize step (self-enrollment)

Each connector needs a one-time per-tenant consent (3LO). The first time a tenant uses a connector, the
shim returns `requires_authorization` with an `authorization_url`. The user opens it, grants access, and
the browser is redirected back to the web GUI with `?session_id=<sessionUri>`.

That return is not the end of the flow. AgentCore only holds the token against that session until the
application confirms it with `CompleteResourceTokenAuth`; without that call the token is never promoted
into the durable vault and every later request just restarts consent. The web SPA does this automatically:
`useConnectorCallback` detects `?session_id=` on load and POSTs it to the BFF route
`/api/connectors/complete`, which calls `CompleteResourceTokenAuth` with the caller's tenant as the
AgentCore userId (the same identity the shim uses). After that the token is vaulted and reads work
headlessly. The BFF role is granted `bedrock-agentcore:CompleteResourceTokenAuth` for this.

Notes learned in live verification:
- AgentCore vaults tokens by the EXACT scope set, so a connector must request the same scopes on every
  call; the three Google connectors share one union scope set so a single consent covers all of them.
- `slack_read_messages` accepts a channel name or id: a name is resolved to its id via
  `conversations.list` (hence the `channels:read`/`groups:read` scopes) before reading history.
- Atlassian needs `offline_access` for a refresh token, and Jira reads use `/rest/api/3/search/jql` (the
  classic `/search` endpoint returns HTTP 410) with a bounded JQL (a `WHERE` restriction is required).
