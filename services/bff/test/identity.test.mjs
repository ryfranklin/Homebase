import test from "node:test";
import assert from "node:assert/strict";

import { makeIdentityClient, sigv4Headers } from "../src/identity.mjs";

const creds = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secretExampleKey",
  sessionToken: "sess-token-xyz",
};

test("sigv4Headers: well-formed signature and signed-header set", () => {
  const h = sigv4Headers({
    host: "bedrock-agentcore.us-east-1.amazonaws.com",
    body: '{"userIdentifier":{"userId":"homebase"},"sessionUri":"urn:x"}',
    region: "us-east-1",
    creds,
    amzDate: "20260808T221744Z",
  });
  assert.equal(h["content-type"], "application/json");
  assert.equal(h["x-amz-date"], "20260808T221744Z");
  assert.equal(h["x-amz-security-token"], "sess-token-xyz");
  // Scope is date/region/service/aws4_request.
  assert.match(
    h.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260808\/us-east-1\/bedrock-agentcore\/aws4_request, /,
  );
  // Temp creds -> security token is part of the signed headers.
  assert.match(h.authorization, /SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, /);
  assert.match(h.authorization, /Signature=[0-9a-f]{64}$/);
});

test("sigv4Headers: deterministic for the same inputs", () => {
  const args = {
    host: "bedrock-agentcore.us-east-1.amazonaws.com",
    body: "{}",
    region: "us-east-1",
    creds,
    amzDate: "20260808T221744Z",
  };
  assert.equal(sigv4Headers(args).authorization, sigv4Headers(args).authorization);
});

test("sigv4Headers: omits security token header for long-term creds", () => {
  const h = sigv4Headers({
    host: "bedrock-agentcore.us-east-1.amazonaws.com",
    body: "{}",
    region: "us-east-1",
    creds: { accessKeyId: "AKIA", secretAccessKey: "s" },
    amzDate: "20260808T221744Z",
  });
  assert.equal(h["x-amz-security-token"], undefined);
  assert.match(h.authorization, /SignedHeaders=content-type;host;x-amz-date, /);
});

test("completeResourceTokenAuth: POSTs the signed CompleteResourceTokenAuth request", async () => {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200 };
  };
  const client = await makeIdentityClient("us-east-1", {
    fetchImpl,
    env: { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "s", AWS_SESSION_TOKEN: "t" },
    now: () => new Date("2026-08-08T22:17:44.263Z"),
  });

  await client.completeResourceTokenAuth({ userId: "homebase", sessionUri: "urn:sess:1" });

  assert.equal(captured.url, "https://bedrock-agentcore.us-east-1.amazonaws.com/identities/CompleteResourceTokenAuth");
  assert.equal(captured.init.method, "POST");
  assert.deepEqual(JSON.parse(captured.init.body), {
    userIdentifier: { userId: "homebase" },
    sessionUri: "urn:sess:1",
  });
  // Host is signed but not set on the fetch call (undici manages it).
  assert.equal(captured.init.headers.host, undefined);
  assert.match(captured.init.headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.equal(captured.init.headers["x-amz-security-token"], "t");
});

test("completeResourceTokenAuth: throws on a non-ok response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => "AccessDenied" });
  const client = await makeIdentityClient("us-east-1", {
    fetchImpl,
    env: { AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "s" },
    now: () => new Date("2026-08-08T22:17:44.263Z"),
  });
  await assert.rejects(
    () => client.completeResourceTokenAuth({ userId: "homebase", sessionUri: "urn:x" }),
    /CompleteResourceTokenAuth 403/,
  );
});
