import test from "node:test";
import assert from "node:assert/strict";

import { handleRequest } from "../src/bff.mjs";

const CFG = { issuer: "i", audience: "a", agentRuntimeArn: "arn", allowedOrigin: "https://app.example.invalid" };

function verifyToken() {
  return { sub: "user-1", "custom:tenant_id": "tenant-1" };
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

async function route({ connectorStatus }) {
  const respond = makeRespond();
  await handleRequest(
    {
      headers: { authorization: "Bearer t" },
      rawPath: "/api/connectors/status",
      requestContext: { http: { method: "GET", path: "/api/connectors/status" } },
    },
    respond,
    { verifyToken, config: CFG, connectorStatus },
  );
  const rec = respond.calls[0];
  return { rec, json: () => JSON.parse(rec.chunks.join("")) };
}

test("GET /api/connectors/status returns the tenant's connector statuses", async () => {
  const seen = [];
  const connectorStatus = {
    async statuses(tenantId) {
      seen.push(tenantId);
      return { connectors: { slack: { status: "connected" }, gmail: { status: "needs_auth", authorizationUrl: "https://x" } } };
    },
  };
  const { rec, json } = await route({ connectorStatus });
  assert.equal(rec.statusCode, 200);
  assert.equal(json().connectors.slack.status, "connected");
  assert.equal(json().connectors.gmail.authorizationUrl, "https://x");
  assert.deepEqual(seen, ["tenant-1"]); // scoped to the verified tenant
});

test("status route degrades to an empty map when not configured", async () => {
  const { rec, json } = await route({ connectorStatus: undefined });
  assert.equal(rec.statusCode, 200);
  assert.deepEqual(json(), { connectors: {} });
});
