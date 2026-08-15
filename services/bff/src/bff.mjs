// Core BFF request handling, independent of the Lambda streaming wrapper so it
// is unit-testable with a fake response stream and injected dependencies.
//
// Security posture:
// - Validates the Cognito JWT in-function (deps.verifyToken).
// - Enforces per-user AND per-tenant scoping from the claims. The tenant used is
//   ALWAYS the one in the verified token; if the request body names a different
//   tenant, the request is rejected (cross-tenant attempt), never honored.

import { timingSafeEqual } from "node:crypto";

import { SSE_HEADERS, sseEvent } from "./sse.mjs";

const TENANT_CLAIM = "custom:tenant_id";
const ORIGIN_SECRET_HEADER = "x-origin-secret";

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Build the display identity used to attribute vault writes. The access token
// (used for authz) carries no email/name for a federated user, so prefer the
// verified ID token's profile claims when present, then the access-token username
// claim (Cognito access tokens use `username`, not `cognito:username`), then the
// opaque subject as a last resort.
function deriveActor(accessClaims, idClaims) {
  const id = accessClaims.sub;
  const c = idClaims || {};
  const email = c.email || null;
  const name =
    c.name ||
    [c.given_name, c.family_name].filter(Boolean).join(" ").trim() ||
    email ||
    accessClaims.username ||
    accessClaims["cognito:username"] ||
    id;
  return { id, name, email };
}

function corsHeaders(allowedOrigin) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-id-token",
    Vary: "Origin",
  };
}

function queryParams(event) {
  if (event.queryStringParameters) return event.queryStringParameters;
  const raw = event.rawQueryString || "";
  const out = {};
  for (const pair of raw.split("&")) {
    if (!pair) continue;
    const [k, v = ""] = pair.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return out;
}

function writeJson(respond, cors, status, obj) {
  const writer = respond(status, { "Content-Type": "application/json", ...cors });
  writer.write(JSON.stringify(obj));
  writer.end();
}

// Vault CRUD + search + backlinks over the S3 Markdown corpus. Auth, tenant, and
// origin checks have already run in handleRequest; deps.vault is present only when
// the corpus is configured on this deployment.
async function handleVault(resource, method, event, body, respond, cors, deps, actor) {
  if (!deps.vault) {
    return writeError(respond, cors, 503, "vault_unconfigured", "vault is not enabled on this deployment");
  }
  const q = queryParams(event);
  try {
    if (resource === "tree" && method === "GET") {
      return writeJson(respond, cors, 200, await deps.vault.tree());
    }
    if (resource === "search" && method === "GET") {
      return writeJson(respond, cors, 200, await deps.vault.search(q.q ?? ""));
    }
    if (resource === "backlinks" && method === "GET") {
      return writeJson(respond, cors, 200, await deps.vault.backlinks(q.key ?? ""));
    }
    if (resource === "history" && method === "GET") {
      return writeJson(respond, cors, 200, await deps.vault.history(q.key ?? ""));
    }
    if (resource === "restore" && method === "POST") {
      return writeJson(respond, cors, 200, await deps.vault.restore(body.key ?? "", body.versionId ?? "", actor));
    }
    if (resource === "note" && method === "GET") {
      return writeJson(respond, cors, 200, await deps.vault.get(q.key ?? ""));
    }
    if (resource === "note" && method === "PUT") {
      return writeJson(respond, cors, 200, await deps.vault.put(body.key ?? "", body.content ?? "", actor));
    }
    if (resource === "note" && method === "DELETE") {
      return writeJson(respond, cors, 200, await deps.vault.del(q.key ?? body.key ?? "", actor));
    }
    return writeError(respond, cors, 405, "method_not_allowed", `${method} not allowed on ${resource}`);
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "vault_error";
    if (status >= 500) {
      console.error(JSON.stringify({ event: "vault_error", resource, method, code, message: String(err?.message || "").slice(0, 300) }));
      return writeError(respond, cors, 502, "vault_error", "vault operation failed");
    }
    return writeError(respond, cors, status, code, err.message);
  }
}

function extractBearer(event) {
  const headers = event.headers || {};
  const raw = headers.authorization || headers.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1] : null;
}

function parseBody(event) {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function writeError(respond, cors, status, code, message) {
  const writer = respond(status, { "Content-Type": "application/json", ...cors });
  writer.write(JSON.stringify({ error: code, message: message || code }));
  writer.end();
}

const MISSION_DECISIONS = new Set(["approve", "reject", "scrub", "cancel"]);

// Mission Control execution seam: launch runs from flight-plan units, read/list
// runs, stream live telemetry, and drive the go/no-go gate. Auth + tenant + origin
// checks already ran in handleRequest. deps.missionControl is present only when the
// Mission Control base URL is configured on this deployment.
async function handleMissions(rest, method, event, body, respond, cors, deps) {
  if (!deps.missionControl) {
    return writeError(respond, cors, 503, "mission_unconfigured", "mission control is not enabled on this deployment");
  }
  const mc = deps.missionControl;
  const segments = rest.split("/").filter(Boolean); // e.g. ["runs"], ["runs", "<id>", "approve"]
  const q = queryParams(event);

  // GET /missions/runs/<id>/events -> proxy the SSE telemetry stream to the SPA.
  if (segments[0] === "runs" && segments[2] === "events" && method === "GET") {
    return proxyMissionEvents(mc, decodeURIComponent(segments[1]), q.last_event_id, respond, cors);
  }

  try {
    if (segments[0] === "runs" && segments.length === 1) {
      if (method === "GET") return writeJson(respond, cors, 200, await mc.list(q));
      if (method === "POST") {
        const run = body.plan && body.unit ? await mc.launchUnit(body.plan, body.unit) : await mc.launch(body);
        return writeJson(respond, cors, 201, run);
      }
    }
    if (segments[0] === "runs" && segments.length === 2 && method === "GET") {
      return writeJson(respond, cors, 200, await mc.get(decodeURIComponent(segments[1])));
    }
    if (segments[0] === "runs" && segments[2] === "changes" && method === "GET") {
      return writeJson(respond, cors, 200, await mc.changes(decodeURIComponent(segments[1])));
    }
    if (segments[0] === "runs" && segments.length === 3 && method === "POST" && MISSION_DECISIONS.has(segments[2])) {
      return writeJson(respond, cors, 200, await mc.decide(decodeURIComponent(segments[1]), segments[2]));
    }
    if (segments[0] === "metrics" && method === "GET") {
      return writeJson(respond, cors, 200, await mc.metrics(q));
    }
    return writeError(respond, cors, 404, "not_found", "no such mission route");
  } catch (err) {
    const status = err?.status && err.status < 500 ? err.status : 502;
    console.error(JSON.stringify({ event: "mission_error", path: rest, message: String(err?.message || "").slice(0, 200) }));
    return writeError(respond, cors, status, err?.code || "mission_control_error", status >= 500 ? "mission control error" : err.message);
  }
}

// Relay Mission Control's SSE telemetry to the browser over our own SSE response,
// with an immediate byte + keepalives so CloudFront's origin timeout never fires.
async function proxyMissionEvents(mc, runId, lastEventId, respond, cors) {
  const writer = respond(200, { ...SSE_HEADERS, ...cors });
  writer.write(": open\n\n");
  const heartbeat = setInterval(() => {
    try {
      writer.write(": keepalive\n\n");
    } catch {
      /* closed */
    }
  }, 10000);
  try {
    for await (const evt of mc.events(runId, { lastEventId })) {
      // Data-only frame with the MC event name in `type`, matching how the SPA's
      // SSE client switches on message type (see chat).
      writer.write(sseEvent({ type: evt.event, data: evt.data }));
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "mission_events_error", run: runId, message: String(err?.message || "").slice(0, 200) }));
    try {
      writer.write(sseEvent({ type: "error", message: "telemetry stream ended" }));
    } catch {
      /* closed */
    }
  } finally {
    clearInterval(heartbeat);
    try {
      writer.end();
    } catch {
      /* closed */
    }
  }
}

// handleRequest(event, respond, deps)
//   respond(statusCode, headers) -> { write(chunk), end() }
//   deps = { verifyToken(token) -> claims, config, agentStream(args) -> async iterable,
//            completeConnectorAuth({ userId, sessionUri }) -> Promise }
export async function handleRequest(event, respond, deps) {
  const { config } = deps;
  const cors = corsHeaders(config.allowedOrigin);

  const method = (event.requestContext?.http?.method || event.httpMethod || "POST").toUpperCase();
  if (method === "OPTIONS") {
    const writer = respond(204, cors);
    writer.end();
    return;
  }

  // Route by path. /api/connectors/complete finalizes a connector's 3LO consent
  // (see the branch below); everything else is the agent chat stream.
  const path = event.rawPath || event.requestContext?.http?.path || event.path || "";
  const isConnectorComplete = path.endsWith("/connectors/complete");

  // Origin protection: when a shared secret is configured, the request must
  // carry the matching header that CloudFront injects. This refuses direct
  // hits on the Function URL that bypass CloudFront and the WAF.
  //
  // Multiple acceptable values are supported so a Secrets Manager ROTATION works:
  // during the window both the current and pending secret are accepted, so
  // CloudFront's header update and the secret promotion need not be atomic.
  const acceptableSecrets = [
    ...(config.originSharedSecret ? [config.originSharedSecret] : []),
    ...(config.originSharedSecrets || []),
  ].filter(Boolean);
  if (acceptableSecrets.length > 0) {
    const headers = event.headers || {};
    const provided = headers[ORIGIN_SECRET_HEADER] ?? headers["X-Origin-Secret"] ?? "";
    const ok = acceptableSecrets.some((secret) => constantTimeEqual(provided, secret));
    if (!ok) {
      return writeError(respond, cors, 403, "forbidden_origin", "missing or invalid origin header");
    }
  }

  const token = extractBearer(event);
  if (!token) {
    return writeError(respond, cors, 401, "missing_token", "no bearer token");
  }

  let claims;
  try {
    claims = await deps.verifyToken(token);
  } catch (err) {
    return writeError(respond, cors, 401, err.code || "invalid_token", err.message);
  }

  const userId = claims.sub;
  // Prefer the verified tenant claim; fall back to the deployment's default tenant
  // (the single-tenant seed) when the token carries none. The connector shim applies
  // the same default, so the tenant used here matches the one the connector token
  // vault is keyed by.
  const tenantId = claims[TENANT_CLAIM] || config.defaultTenant;
  if (!userId || !tenantId) {
    // Cannot scope the request without both identities.
    return writeError(respond, cors, 403, "missing_identity_claims", "token lacks user or tenant");
  }

  const body = parseBody(event);
  if (body.tenant_id && body.tenant_id !== tenantId) {
    // Cross-tenant attempt: the body asks for a tenant the token does not grant.
    return writeError(respond, cors, 403, "tenant_mismatch", "requested tenant does not match token");
  }
  if (body.user_id && body.user_id !== userId) {
    return writeError(respond, cors, 403, "user_mismatch", "requested user does not match token");
  }

  // Connector consent finalize: after the user completes a connector's 3LO consent
  // in the browser, AgentCore redirects back with ?session_id=<sessionUri>. The SPA
  // POSTs that here so we call CompleteResourceTokenAuth, which promotes the OAuth
  // token into the durable vault for headless reuse by the shim. The AgentCore
  // userId is the TENANT id (matching what the connector shim uses when it mints a
  // workload token), taken from the verified token, never the client body.
  if (isConnectorComplete) {
    const sessionUri = body.session_id;
    if (!sessionUri) {
      return writeError(respond, cors, 400, "missing_session", "session_id is required");
    }
    try {
      await deps.completeConnectorAuth({ userId: tenantId, sessionUri });
      console.log(JSON.stringify({ event: "connector_finalize", ok: true, tenant: tenantId }));
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "connector_finalize",
          ok: false,
          tenant: tenantId,
          error: err?.name || "error",
          message: String(err?.message || "").slice(0, 300),
        }),
      );
      return writeError(respond, cors, 502, "connector_finalize_failed", "could not finalize connector authorization");
    }
    const writer = respond(200, { "Content-Type": "application/json", ...cors });
    writer.write(JSON.stringify({ ok: true }));
    writer.end();
    return;
  }

  // Vault workspace: browse / read / edit / search the Markdown corpus. Scoped by
  // the verified tenant (single-tenant seed: the whole corpus is the vault).
  const vaultMatch = /\/vault\/(tree|note|search|backlinks|history|restore)$/.exec(path);
  if (vaultMatch) {
    // Attribution: the access token authorizes the request but, for a federated
    // user, has no email/name. If the SPA also sent a verified ID token (x-id-token)
    // for the SAME subject, use its profile claims for authorship.
    let idClaims = null;
    const headers = event.headers || {};
    const idToken = headers["x-id-token"] ?? headers["X-Id-Token"];
    if (idToken) {
      try {
        const verified = await deps.verifyToken(idToken);
        if (verified.token_use === "id" && verified.sub === userId) idClaims = verified;
      } catch {
        /* ignore an unusable id token; fall back to the access-token identity */
      }
    }
    const actor = deriveActor(claims, idClaims);
    return handleVault(vaultMatch[1], method, event, body, respond, cors, deps, actor);
  }

  // Connector connection status (what's actually connected), scoped to the tenant.
  if (method === "GET" && path.endsWith("/connectors/status")) {
    if (!deps.connectorStatus) return writeJson(respond, cors, 200, { connectors: {} });
    try {
      return writeJson(respond, cors, 200, await deps.connectorStatus.statuses(tenantId));
    } catch (err) {
      console.error(JSON.stringify({ event: "connector_status_error", message: String(err?.message || "").slice(0, 200) }));
      return writeError(respond, cors, 502, "connector_status_error", "could not read connector status");
    }
  }

  // Mission Control execution seam: launch runs from flight-plan units, stream
  // telemetry, drive the go/no-go gate. Authenticated by the checks above.
  const missionMatch = /\/missions\/(.+)$/.exec(path);
  if (missionMatch) {
    return handleMissions(missionMatch[1], method, event, body, respond, cors, deps);
  }

  const sessionId = body.session_id || `${tenantId}:${userId}`;
  const prompt = body.input ?? body.prompt ?? "";

  const writer = respond(200, { ...SSE_HEADERS, ...cors });
  // Send a byte immediately and keepalives every 10s. The agent can run a multi-step
  // tool loop for tens of seconds; without early/periodic bytes CloudFront's
  // origin-response timeout (30s) fires and the request 504s. SSE comment lines
  // (":" prefix) are ignored by the client parser.
  writer.write(": open\n\n");
  const heartbeat = setInterval(() => {
    try {
      writer.write(": keepalive\n\n");
    } catch {
      /* stream already closed */
    }
  }, 10000);
  try {
    const stream = deps.agentStream({
      runtimeArn: config.agentRuntimeArn,
      sessionId,
      userId,
      tenantId,
      prompt,
    });
    for await (const evt of stream) {
      writer.write(sseEvent(evt));
    }
    writer.write(sseEvent({ type: "done" }));
  } catch (err) {
    writer.write(sseEvent({ type: "error", message: "agent_error" }));
  } finally {
    clearInterval(heartbeat);
    writer.end();
  }
}
