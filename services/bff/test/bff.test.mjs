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

function makeEvent({ token, body, method = "POST" } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method } },
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

async function run({ token, body, method } = {}) {
  const respond = makeRespond();
  const agentStream = makeAgentStream();
  await handleRequest(makeEvent({ token, body, method }), respond, { verifyToken, config, agentStream });
  return { respond, agentStream, rec: respond.calls[0] };
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

test("token missing tenant claim -> 403", async () => {
  const c = claims();
  delete c["custom:tenant_id"];
  const token = signJwt(c, key);
  const { rec } = await run({ token, body: { input: "x" } });
  assert.equal(rec.statusCode, 403);
  assert.match(rec.chunks.join(""), /missing_identity_claims/);
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
