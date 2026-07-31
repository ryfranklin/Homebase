import test from "node:test";
import assert from "node:assert/strict";

import { handleRequest } from "../src/bff.mjs";
import { loadOriginSecrets, cachedOriginSecrets } from "../src/secrets.mjs";
import { verifyJwt } from "../src/jwt.mjs";
import { jwksFor, makeKeypair, nowSec, signJwt } from "./helpers.mjs";

const ISSUER = "https://issuer.example.invalid/pool";
const AUDIENCE = "app-client-example";
const key = makeKeypair("kid-1");
const jwks = jwksFor(key);

function verifyToken(token) {
  return verifyJwt(token, { issuer: ISSUER, audience: AUDIENCE, jwks });
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

function claims() {
  const now = nowSec();
  return { sub: "u1", "custom:tenant_id": "t1", iss: ISSUER, aud: AUDIENCE, iat: now, exp: now + 3600 };
}

async function agentStream() {
  return (async function* () {
    yield { type: "token", text: "hi" };
  })();
}

async function run(originSecretHeader, originSharedSecrets) {
  const respond = makeRespond();
  const config = {
    issuer: ISSUER,
    audience: AUDIENCE,
    agentRuntimeArn: "arn:example",
    allowedOrigin: "https://app.example.invalid",
    originSharedSecrets,
  };
  const event = {
    headers: { authorization: `Bearer ${signJwt(claims(), key)}`, "x-origin-secret": originSecretHeader },
    body: JSON.stringify({ input: "x" }),
    requestContext: { http: { method: "POST" } },
  };
  await handleRequest(event, respond, { verifyToken, config, agentStream: () => agentStream() });
  return respond.calls[0];
}

test("rotation window: both current and pending secrets are accepted", async () => {
  const secrets = ["current-secret", "pending-secret"];
  assert.equal((await run("current-secret", secrets)).statusCode, 200);
  assert.equal((await run("pending-secret", secrets)).statusCode, 200);
});

test("a value outside the accepted set is refused", async () => {
  const rec = await run("stale-secret", ["current-secret", "pending-secret"]);
  assert.equal(rec.statusCode, 403);
  assert.match(rec.chunks.join(""), /forbidden_origin/);
});

test("loadOriginSecrets returns current and pending, tolerating a missing pending", async () => {
  const fake = {
    getSecretValue: async ({ VersionStage }) => {
      if (VersionStage === "AWSCURRENT") return { SecretString: "cur" };
      throw new Error("no pending stage");
    },
  };
  assert.deepEqual(await loadOriginSecrets(fake, "arn:secret"), ["cur"]);
});

test("cachedOriginSecrets caches within the TTL", async () => {
  let calls = 0;
  const fake = {
    getSecretValue: async ({ VersionStage }) => {
      if (VersionStage === "AWSCURRENT") {
        calls += 1;
        return { SecretString: "cur" };
      }
      return {};
    },
  };
  let t = 0;
  const loader = cachedOriginSecrets(fake, "arn", { ttlMs: 1000, now: () => t });
  await loader();
  await loader();
  assert.equal(calls, 1); // cached
  t = 2000;
  await loader();
  assert.equal(calls, 2); // expired, refetched
});
