import test from "node:test";
import assert from "node:assert/strict";

import { handleRequest } from "../src/bff.mjs";
import { verifyJwt } from "../src/jwt.mjs";
import { jwksFor, makeKeypair, nowSec, signJwt } from "./helpers.mjs";

const ISSUER = "https://issuer.example.invalid/pool";
const AUDIENCE = "app-client-example";
const ALLOWED_ORIGIN = "https://app.example.invalid";

const key = makeKeypair("kid-1");
const jwks = jwksFor(key);

const config = {
  issuer: ISSUER,
  audience: AUDIENCE,
  agentRuntimeArn: "arn:aws:bedrock-agentcore:region:acct:runtime/example",
  allowedOrigin: ALLOWED_ORIGIN,
};

function verifyToken(token) {
  return verifyJwt(token, { issuer: ISSUER, audience: AUDIENCE, jwks });
}

// Fake agent stream: records whether it was called, yields a couple of events.
function makeAgentStream() {
  const calls = [];
  async function* agentStream(args) {
    calls.push(args);
    yield { type: "token", text: "hello" };
    yield { type: "citation", source_path: "ops/key-rotation.md" };
  }
  agentStream.calls = calls;
  return agentStream;
}

function makeRespond() {
  const calls = [];
  const respond = (statusCode, headers) => {
    const rec = { statusCode, headers, chunks: [], ended: false };
    calls.push(rec);
    return { write: (c) => rec.chunks.push(c), end: () => (rec.ended = true) };
  };
  respond.calls = calls;
  return respond;
}

function makeEvent({ token, body, method = "POST", originSecret, path } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (originSecret !== undefined) headers["x-origin-secret"] = originSecret;
  return {
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    rawPath: path,
    requestContext: { http: { method, path } },
  };
}

function claims(overrides = {}) {
  const now = nowSec();
  return {
    sub: "user-1",
    "custom:tenant_id": "tenant-1",
    iss: ISSUER,
    aud: AUDIENCE,
    token_use: "id",
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

function makeCompleteConnectorAuth() {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
  };
  fn.calls = calls;
  return fn;
}

async function run({ token, body, method, originSecret, cfg, path, completeConnectorAuth } = {}) {
  const respond = makeRespond();
  const agentStream = makeAgentStream();
  const finalize = completeConnectorAuth ?? makeCompleteConnectorAuth();
  await handleRequest(makeEvent({ token, body, method, originSecret, path }), respond, {
    verifyToken,
    config: cfg ?? config,
    agentStream,
    completeConnectorAuth: finalize,
  });
  return { respond, agentStream, finalize, rec: respond.calls[0] };
}

test("valid token streams SSE with tokens and a done event", async () => {
  const token = signJwt(claims(), key);
  const { rec, agentStream } = await run({ token, body: { input: "how to rotate the key" } });

  assert.equal(rec.statusCode, 200);
  assert.equal(rec.headers["Content-Type"], "text/event-stream");
  assert.equal(rec.headers["Access-Control-Allow-Origin"], ALLOWED_ORIGIN);
  const stream = rec.chunks.join("");
  assert.match(stream, /"type":"token"/);
  assert.match(stream, /"type":"citation"/);
  assert.match(stream, /"type":"done"/);
  assert.ok(rec.ended);
  // The agent was invoked with the identity taken from the token, not the body.
  assert.equal(agentStream.calls[0].userId, "user-1");
  assert.equal(agentStream.calls[0].tenantId, "tenant-1");
});

// Connector consent finalize (/api/connectors/complete).
test("connector complete: finalizes with the token's tenant as the AgentCore userId", async () => {
  const token = signJwt(claims({ sub: "user-1", "custom:tenant_id": "tenant-1" }), key);
  const { rec, finalize, agentStream } = await run({
    token,
    path: "/api/connectors/complete",
    body: { session_id: "urn:ietf:params:oauth:request_uri:abc" },
  });
  assert.equal(rec.statusCode, 200);
  assert.equal(rec.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(rec.chunks.join("")), { ok: true });
  // userId is the TENANT (matches the connector shim), taken from the token.
  assert.deepEqual(finalize.calls[0], {
    userId: "tenant-1",
    sessionUri: "urn:ietf:params:oauth:request_uri:abc",
  });
  assert.equal(agentStream.calls.length, 0); // never streams the agent
});

test("connector complete: missing session_id -> 400", async () => {
  const token = signJwt(claims(), key);
  const { rec, finalize } = await run({ token, path: "/api/connectors/complete", body: {} });
  assert.equal(rec.statusCode, 400);
  assert.match(rec.chunks.join(""), /missing_session/);
  assert.equal(finalize.calls.length, 0);
});

test("connector complete: requires a valid token (401 when missing)", async () => {
  const { rec, finalize } = await run({
    path: "/api/connectors/complete",
    body: { session_id: "urn:x" },
  });
  assert.equal(rec.statusCode, 401);
  assert.equal(finalize.calls.length, 0);
});

test("connector complete: SDK failure -> 502", async () => {
  const token = signJwt(claims(), key);
  const failing = Object.assign(
    async () => {
      throw new Error("boom");
    },
    { calls: [] },
  );
  const { rec } = await run({
    token,
    path: "/api/connectors/complete",
    body: { session_id: "urn:x" },
    completeConnectorAuth: failing,
  });
  assert.equal(rec.statusCode, 502);
  assert.match(rec.chunks.join(""), /connector_finalize_failed/);
});

test("missing token -> 401", async () => {
  const { rec } = await run({ body: { input: "x" } });
  assert.equal(rec.statusCode, 401);
  assert.match(rec.chunks.join(""), /missing_token/);
});

test("expired token -> 401", async () => {
  const token = signJwt(claims({ exp: nowSec() - 3600 }), key);
  const { rec, agentStream } = await run({ token, body: { input: "x" } });
  assert.equal(rec.statusCode, 401);
  assert.match(rec.chunks.join(""), /token_expired/);
  assert.equal(agentStream.calls.length, 0); // never reached the agent
});

test("wrong-audience token -> 401", async () => {
  const token = signJwt(claims({ aud: "other-client" }), key);
  const { rec } = await run({ token, body: { input: "x" } });
  assert.equal(rec.statusCode, 401);
  assert.match(rec.chunks.join(""), /wrong_audience/);
});

test("wrong-tenant: body tenant differs from token claim -> 403, agent not called", async () => {
  const token = signJwt(claims({ "custom:tenant_id": "tenant-1" }), key);
  const { rec, agentStream } = await run({ token, body: { input: "x", tenant_id: "tenant-2" } });
  assert.equal(rec.statusCode, 403);
  assert.match(rec.chunks.join(""), /tenant_mismatch/);
  assert.equal(agentStream.calls.length, 0);
});

test("token missing tenant claim -> 403 (no default tenant configured)", async () => {
  const c = claims();
  delete c["custom:tenant_id"];
  const token = signJwt(c, key);
  const { rec } = await run({ token, body: { input: "x" } });
  assert.equal(rec.statusCode, 403);
  assert.match(rec.chunks.join(""), /missing_identity_claims/);
});

// Single-tenant seed: when a default tenant is configured, a token without the
// tenant claim falls back to it (matching the connector shim), instead of 403.
const seedConfig = { ...config, defaultTenant: "homebase" };

test("missing tenant claim + default tenant -> streams with the default tenant", async () => {
  const c = claims();
  delete c["custom:tenant_id"];
  const token = signJwt(c, key);
  const { rec, agentStream } = await run({ token, body: { input: "x" }, cfg: seedConfig });
  assert.equal(rec.statusCode, 200);
  assert.equal(agentStream.calls[0].tenantId, "homebase");
});

test("connector complete + default tenant -> finalizes under the default tenant", async () => {
  const c = claims();
  delete c["custom:tenant_id"];
  const token = signJwt(c, key);
  const { rec, finalize } = await run({
    token,
    path: "/api/connectors/complete",
    body: { session_id: "urn:sess:9" },
    cfg: seedConfig,
  });
  assert.equal(rec.statusCode, 200);
  assert.equal(finalize.calls[0].userId, "homebase");
});

test("cross-user attempt: body user differs from token -> 403", async () => {
  const token = signJwt(claims(), key);
  const { rec } = await run({ token, body: { input: "x", user_id: "someone-else" } });
  assert.equal(rec.statusCode, 403);
  assert.match(rec.chunks.join(""), /user_mismatch/);
});

test("OPTIONS preflight -> 204 with CORS", async () => {
  const { rec } = await run({ method: "OPTIONS" });
  assert.equal(rec.statusCode, 204);
  assert.equal(rec.headers["Access-Control-Allow-Origin"], ALLOWED_ORIGIN);
});

// Origin protection (shared secret injected by CloudFront).
const secretConfig = { ...config, originSharedSecret: "s3cr3t-from-secrets-manager" };

test("with origin secret configured, missing header -> 403 (WAF-bypass refused)", async () => {
  const token = signJwt(claims(), key);
  const { rec, agentStream } = await run({ token, body: { input: "x" }, cfg: secretConfig });
  assert.equal(rec.statusCode, 403);
  assert.match(rec.chunks.join(""), /forbidden_origin/);
  assert.equal(agentStream.calls.length, 0);
});

test("with origin secret configured, wrong header -> 403", async () => {
  const token = signJwt(claims(), key);
  const { rec } = await run({ token, body: { input: "x" }, originSecret: "wrong", cfg: secretConfig });
  assert.equal(rec.statusCode, 403);
  assert.match(rec.chunks.join(""), /forbidden_origin/);
});

test("with origin secret configured, correct header -> streams", async () => {
  const token = signJwt(claims(), key);
  const { rec } = await run({
    token,
    body: { input: "x" },
    originSecret: "s3cr3t-from-secrets-manager",
    cfg: secretConfig,
  });
  assert.equal(rec.statusCode, 200);
  assert.match(rec.chunks.join(""), /"type":"done"/);
});
