// Core BFF request handling, independent of the Lambda streaming wrapper so it
// is unit-testable with a fake response stream and injected dependencies.
//
// Security posture:
// - Validates the Cognito JWT in-function (deps.verifyToken).
// - Enforces per-user AND per-tenant scoping from the claims. The tenant used is
//   ALWAYS the one in the verified token; if the request body names a different
//   tenant, the request is rejected (cross-tenant attempt), never honored.

import { SSE_HEADERS, sseEvent } from "./sse.mjs";

const TENANT_CLAIM = "custom:tenant_id";

function corsHeaders(allowedOrigin) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    Vary: "Origin",
  };
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

// handleRequest(event, respond, deps)
//   respond(statusCode, headers) -> { write(chunk), end() }
//   deps = { verifyToken(token) -> claims, config, agentStream(args) -> async iterable }
export async function handleRequest(event, respond, deps) {
  const { config } = deps;
  const cors = corsHeaders(config.allowedOrigin);

  const method = (event.requestContext?.http?.method || event.httpMethod || "POST").toUpperCase();
  if (method === "OPTIONS") {
    const writer = respond(204, cors);
    writer.end();
    return;
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
  const tenantId = claims[TENANT_CLAIM];
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

  const sessionId = body.session_id || `${tenantId}:${userId}`;
  const prompt = body.input ?? body.prompt ?? "";

  const writer = respond(200, { ...SSE_HEADERS, ...cors });
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
    writer.end();
  }
}
