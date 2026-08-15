import test from "node:test";
import assert from "node:assert/strict";

import { makeMissionControl, mapUnitToLaunch, buildPrompt, acceptanceCriteria, unitAcceptanceCriteria, parseSse } from "../src/mission.mjs";

const PLAN = {
  target: "git@github.com:acme/app.git",
  title: "Homebase MCP relay",
  objective: "Expose Homebase as an MCP server.",
  context: "Reuses the AgentCore Gateway.",
  criteria: [
    { statement: "Engineers authenticate via a Cognito JWT.", status: "approved" },
    { statement: "Rate limits are enforced.", status: "proposed" },
  ],
};

function jsonFetch(calls, response = { ok: true, status: 200, body: {} }) {
  return async (url, init) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status,
      async json() {
        return response.body;
      },
      async text() {
        return JSON.stringify(response.body);
      },
    };
  };
}

// A fake web ReadableStream body for the SSE tests.
function sseBody(frames) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        read: async () => (i < frames.length ? { value: enc.encode(frames[i++]), done: false } : { value: undefined, done: true }),
        releaseLock() {},
      };
    },
  };
}

// --- Contract: flight-plan unit -> Mission Control run ---

test("mapUnitToLaunch derives task_type from the AI-DLC phase", () => {
  assert.equal(mapUnitToLaunch(PLAN, { title: "Investigate", phase: "INCEPTION" }).task_type, "sim");
  assert.equal(mapUnitToLaunch(PLAN, { title: "Build it", phase: "CONSTRUCTION" }).task_type, "burn");
  // Default (unspecified phase) is the side-effectful build.
  assert.equal(mapUnitToLaunch(PLAN, { title: "x" }).task_type, "burn");
  assert.equal(mapUnitToLaunch(PLAN, { title: "x" }).target, PLAN.target);
});

test("acceptanceCriteria / mapUnitToLaunch carry only the approved criteria across the seam", () => {
  assert.deepEqual(acceptanceCriteria(PLAN), ["Engineers authenticate via a Cognito JWT."]);
  // proposed criteria are excluded; the launch body carries the approved DoD structured
  // so Mission Control's verify node can judge the burn's output against it.
  assert.deepEqual(
    mapUnitToLaunch(PLAN, { title: "Build it", phase: "CONSTRUCTION" }).acceptance_criteria,
    ["Engineers authenticate via a Cognito JWT."],
  );
});

test("a unit's own acceptance criteria override the plan's; blank/absent fall back", () => {
  const own = { title: "Build", phase: "CONSTRUCTION", criteria: ["Create returns 201", "Missing id returns 404"] };
  assert.deepEqual(unitAcceptanceCriteria(PLAN, own), ["Create returns 201", "Missing id returns 404"]);
  assert.deepEqual(mapUnitToLaunch(PLAN, own).acceptance_criteria, ["Create returns 201", "Missing id returns 404"]);
  // no unit criteria → the plan's approved DoD (prior behavior, unchanged)
  assert.deepEqual(unitAcceptanceCriteria(PLAN, { title: "Build" }), ["Engineers authenticate via a Cognito JWT."]);
  // blank-only criteria don't count as the unit having its own
  assert.deepEqual(unitAcceptanceCriteria(PLAN, { title: "Build", criteria: ["  "] }), ["Engineers authenticate via a Cognito JWT."]);
});

test("buildPrompt uses the unit's criteria as the definition of done when present", () => {
  const p = buildPrompt(PLAN, { title: "Build", criteria: ["Create returns 201"], instruction: "do it" });
  assert.ok(p.includes("## Definition of done"));
  assert.ok(p.includes("- Create returns 201"));
  assert.ok(!p.includes("Engineers authenticate")); // the unit DoD overrides the plan DoD
});

test("buildPrompt is deterministic and carries the approved acceptance criteria", () => {
  const p = buildPrompt(PLAN, { title: "Define MCP tool schemas", instruction: "Write the tool specs." });
  assert.ok(p.includes("# Define MCP tool schemas"));
  assert.ok(p.includes("Expose Homebase as an MCP server."));
  assert.ok(p.includes("- Engineers authenticate via a Cognito JWT.")); // approved AC
  assert.ok(!p.includes("Rate limits are enforced.")); // proposed AC excluded from DoD
  assert.ok(p.includes("Write the tool specs."));
  assert.equal(p, buildPrompt(PLAN, { title: "Define MCP tool schemas", instruction: "Write the tool specs." }));
});

// --- Client ---

test("launchUnit POSTs the mapped run with the bearer token", async () => {
  const calls = [];
  const mc = makeMissionControl({ baseUrl: "http://mc:8000/", token: "tok", fetchImpl: jsonFetch(calls, { ok: true, status: 201, body: { run_id: "r1", status: "queued" } }) });
  const run = await mc.launchUnit(PLAN, { title: "Build it", phase: "CONSTRUCTION" });
  assert.deepEqual(run, { run_id: "r1", status: "queued" });
  assert.equal(calls[0].url, "http://mc:8000/runs"); // trailing slash normalized
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer tok");
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.task_type, "burn");
  assert.equal(sent.target, PLAN.target);
  assert.deepEqual(sent.acceptance_criteria, ["Engineers authenticate via a Cognito JWT."]);
});

test("get / list / changes issue the right GETs", async () => {
  const calls = [];
  const mc = makeMissionControl({ baseUrl: "http://mc:8000", fetchImpl: jsonFetch(calls, { ok: true, status: 200, body: {} }) });
  await mc.get("r1");
  await mc.list({ status: "awaiting_gate", limit: 10 });
  await mc.changes("r1");
  assert.equal(calls[0].url, "http://mc:8000/runs/r1");
  assert.match(calls[1].url, /^http:\/\/mc:8000\/runs\?/);
  assert.ok(calls[1].url.includes("status=awaiting_gate"));
  assert.ok(calls[1].url.includes("limit=10"));
  assert.equal(calls[2].url, "http://mc:8000/runs/r1/changes");
});

test("decide validates the action and POSTs the gate decision", async () => {
  const calls = [];
  const mc = makeMissionControl({ baseUrl: "http://mc:8000", token: "t", fetchImpl: jsonFetch(calls, { ok: true, status: 200, body: { ok: true } }) });
  await mc.decide("r1", "approve");
  assert.equal(calls[0].url, "http://mc:8000/runs/r1/approve");
  assert.equal(calls[0].init.method, "POST");
  await assert.rejects(() => mc.decide("r1", "delete"), (e) => e.status === 400 && e.code === "invalid_decision");
});

test("a 404 from mission control surfaces as a 404, other errors as 502", async () => {
  const notFound = makeMissionControl({ baseUrl: "http://mc:8000", fetchImpl: jsonFetch([], { ok: false, status: 404, body: {} }) });
  await assert.rejects(() => notFound.get("nope"), (e) => e.status === 404);
  const boom = makeMissionControl({ baseUrl: "http://mc:8000", fetchImpl: jsonFetch([], { ok: false, status: 500, body: {} }) });
  await assert.rejects(() => boom.get("r1"), (e) => e.status === 502 && e.code === "mission_control_error");
});

// --- SSE telemetry ---

test("parseSse yields named events with JSON-parsed data and ignores keepalives", async () => {
  const frames = [
    ": open\n\n",
    'event: step_metric\ndata: {"cost_usd":0.0021,"model":"claude-haiku-4-5"}\n\n',
    ": keepalive\n\n",
    'event: gate_waiting\ndata: {"task_id":"t1"}\n\n',
  ];
  const out = [];
  for await (const evt of parseSse(sseBody(frames))) out.push(evt);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { event: "step_metric", data: { cost_usd: 0.0021, model: "claude-haiku-4-5" } });
  assert.deepEqual(out[1], { event: "gate_waiting", data: { task_id: "t1" } });
});

test("events() streams the run's SSE feed", async () => {
  const body = sseBody(['event: node_transition\ndata: {"node":"dispatch"}\n\n']);
  const mc = makeMissionControl({ baseUrl: "http://mc:8000", fetchImpl: async () => ({ ok: true, status: 200, body }) });
  const out = [];
  for await (const evt of mc.events("r1")) out.push(evt);
  assert.deepEqual(out, [{ event: "node_transition", data: { node: "dispatch" } }]);
});
