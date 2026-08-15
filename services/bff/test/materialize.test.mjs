import test from "node:test";
import assert from "node:assert/strict";

import { adf, epicDescription } from "../src/materialize.mjs";
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
async function route({ body, materializer }) {
  const respond = makeRespond();
  await handleRequest(
    {
      headers: { authorization: "Bearer t" },
      body: JSON.stringify(body),
      rawPath: "/api/plan/materialize",
      requestContext: { http: { method: "POST", path: "/api/plan/materialize" } },
    },
    respond,
    { verifyToken, config: CFG, materializer },
  );
  const rec = respond.calls[0];
  return { rec, json: () => JSON.parse(rec.chunks.join("")) };
}

test("adf wraps text into an Atlassian document with a paragraph per block", () => {
  const doc = adf("one\n\ntwo");
  assert.equal(doc.type, "doc");
  assert.equal(doc.content.length, 2);
  assert.equal(doc.content[0].content[0].text, "one");
});

test("epicDescription carries objective, context, and the approved DoD", () => {
  const d = epicDescription({
    objective: "Ship the relay.",
    context: "Reuses the gateway.",
    criteria: [
      { statement: "Auth via JWT.", status: "approved" },
      { statement: "Rate limited.", status: "proposed" },
    ],
  });
  assert.ok(d.includes("Ship the relay."));
  assert.ok(d.includes("Reuses the gateway."));
  assert.ok(d.includes("- Auth via JWT."));
  assert.ok(!d.includes("Rate limited.")); // proposed excluded from DoD
});

test("POST /api/plan/materialize returns the created epic + story keys", async () => {
  const seen = [];
  const materializer = {
    async materialize(tenantId, plan, project) {
      seen.push([tenantId, plan.title, project]);
      return { project: "AIP", epic: "AIP-1", stories: [{ key: "AIP-2", title: "Build" }] };
    },
  };
  const { rec, json } = await route({ body: { plan: { title: "Relay" } }, materializer });
  assert.equal(rec.statusCode, 200);
  assert.equal(json().epic, "AIP-1");
  assert.equal(json().stories[0].key, "AIP-2");
  assert.deepEqual(seen[0], ["tenant-1", "Relay", undefined]); // tenant from token
});

test("materialize 503s when not configured and 400s without a plan", async () => {
  const off = await route({ body: { plan: {} }, materializer: undefined });
  assert.equal(off.rec.statusCode, 503);
  assert.equal(off.json().error, "materialize_unconfigured");

  const noPlan = await route({ body: {}, materializer: { materialize: async () => ({}) } });
  assert.equal(noPlan.rec.statusCode, 400);
  assert.equal(noPlan.json().error, "missing_plan");
});

test("materialize surfaces a connector authorization requirement as a link", async () => {
  const materializer = {
    async materialize() {
      throw Object.assign(new Error("atlassian not linked"), { code: "authorization_required", authorization_url: "https://consent" });
    },
  };
  const { rec, json } = await route({ body: { plan: { title: "x" } }, materializer });
  assert.equal(rec.statusCode, 200);
  assert.equal(json().requires_authorization, true);
  assert.equal(json().authorization_url, "https://consent");
});
