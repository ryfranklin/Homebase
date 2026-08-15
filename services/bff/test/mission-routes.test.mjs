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

async function route({ method, path, body, missionControl }) {
  const respond = makeRespond();
  await handleRequest(
    {
      headers: { authorization: "Bearer t" },
      body: body === undefined ? undefined : JSON.stringify(body),
      rawPath: path,
      requestContext: { http: { method, path } },
    },
    respond,
    { verifyToken, config: CFG, missionControl },
  );
  const rec = respond.calls[0];
  return { rec, json: () => JSON.parse(rec.chunks.join("")) };
}

function fakeMc() {
  const calls = [];
  return {
    calls,
    async launchUnit(plan, unit) {
      calls.push(["launchUnit", plan, unit]);
      return { run_id: "r1", status: "queued" };
    },
    async launch(req) {
      calls.push(["launch", req]);
      return { run_id: "r2", status: "queued" };
    },
    async get(id) {
      calls.push(["get", id]);
      return { run_id: id, status: "awaiting_gate", cost_usd: 0.12 };
    },
    async list(q) {
      calls.push(["list", q]);
      return { runs: [] };
    },
    async decide(id, decision) {
      calls.push(["decide", id, decision]);
      return { ok: true };
    },
  };
}

test("POST /api/missions/runs with {plan, unit} launches the mapped run (201)", async () => {
  const mc = fakeMc();
  const { rec, json } = await route({
    method: "POST",
    path: "/api/missions/runs",
    body: { plan: { target: "repo" }, unit: { title: "Build", phase: "CONSTRUCTION" } },
    missionControl: mc,
  });
  assert.equal(rec.statusCode, 201);
  assert.equal(json().run_id, "r1");
  assert.equal(mc.calls[0][0], "launchUnit");
});

test("POST /api/missions/runs with a raw body launches directly", async () => {
  const mc = fakeMc();
  await route({ method: "POST", path: "/api/missions/runs", body: { target: "repo", task_type: "sim", prompt: "look" }, missionControl: mc });
  assert.equal(mc.calls[0][0], "launch");
});

test("GET /api/missions/runs/<id> returns the run", async () => {
  const mc = fakeMc();
  const { rec, json } = await route({ method: "GET", path: "/api/missions/runs/r1", missionControl: mc });
  assert.equal(rec.statusCode, 200);
  assert.equal(json().status, "awaiting_gate");
  assert.deepEqual(mc.calls[0], ["get", "r1"]);
});

test("POST /api/missions/runs/<id>/approve drives the gate", async () => {
  const mc = fakeMc();
  const { rec } = await route({ method: "POST", path: "/api/missions/runs/r1/approve", missionControl: mc });
  assert.equal(rec.statusCode, 200);
  assert.deepEqual(mc.calls[0], ["decide", "r1", "approve"]);
});

test("an unknown gate action is a 404, not a decision", async () => {
  const mc = fakeMc();
  const { rec } = await route({ method: "POST", path: "/api/missions/runs/r1/destroy", missionControl: mc });
  assert.equal(rec.statusCode, 404);
  assert.equal(mc.calls.length, 0);
});

test("mission routes 503 when Mission Control is not configured", async () => {
  const { rec, json } = await route({ method: "GET", path: "/api/missions/runs/r1", missionControl: undefined });
  assert.equal(rec.statusCode, 503);
  assert.equal(json().error, "mission_unconfigured");
});
