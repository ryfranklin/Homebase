import test from "node:test";
import assert from "node:assert/strict";

import { verifyJwt, JwtError } from "../src/jwt.mjs";
import { jwksFor, makeKeypair, nowSec, signJwt } from "./helpers.mjs";

const ISSUER = "https://issuer.example.invalid/pool";
const AUDIENCE = "app-client-example";

const key = makeKeypair("kid-1");
const jwks = jwksFor(key);

function baseClaims(overrides = {}) {
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

function verify(token) {
  return verifyJwt(token, { issuer: ISSUER, audience: AUDIENCE, jwks });
}

test("valid token verifies and returns claims", () => {
  const claims = verify(signJwt(baseClaims(), key));
  assert.equal(claims.sub, "user-1");
  assert.equal(claims["custom:tenant_id"], "tenant-1");
});

test("expired token is rejected", () => {
  const token = signJwt(baseClaims({ exp: nowSec() - 3600 }), key);
  assert.throws(() => verify(token), (e) => e instanceof JwtError && e.code === "token_expired");
});

test("wrong audience is rejected", () => {
  const token = signJwt(baseClaims({ aud: "some-other-client" }), key);
  assert.throws(() => verify(token), (e) => e.code === "wrong_audience");
});

test("access token client_id is accepted as audience", () => {
  const claims = baseClaims();
  delete claims.aud;
  claims.client_id = AUDIENCE;
  claims.token_use = "access";
  const decoded = verify(signJwt(claims, key));
  assert.equal(decoded.client_id, AUDIENCE);
});

test("wrong issuer is rejected", () => {
  const token = signJwt(baseClaims({ iss: "https://evil.example.invalid/pool" }), key);
  assert.throws(() => verify(token), (e) => e.code === "wrong_issuer");
});

test("signature from an unknown key (unknown kid) is rejected", () => {
  const other = makeKeypair("kid-2");
  const token = signJwt(baseClaims(), other);
  assert.throws(() => verify(token), (e) => e.code === "unknown_kid");
});

test("tampered signature is rejected", () => {
  const token = signJwt(baseClaims(), key);
  const tampered = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.throws(() => verify(tampered), (e) => e.code === "invalid_signature");
});

test("malformed token is rejected", () => {
  assert.throws(() => verify("not.a.jwt.at.all"), (e) => e.code === "malformed_token");
  assert.throws(() => verify("only-one-part"), (e) => e.code === "malformed_token");
});

test("alg none is rejected", () => {
  const token = signJwt(baseClaims(), key, { alg: "none" });
  assert.throws(() => verify(token), (e) => e.code === "unsupported_alg");
});
