import test from "node:test";
import assert from "node:assert/strict";

import { decodeSseStream, invokeAgentRuntimeStream, normalizeRuntimeSessionId } from "../src/agent.mjs";

function byteStreamOf(chunks) {
  const encoder = new TextEncoder();
  return (async function* () {
    for (const c of chunks) yield encoder.encode(c);
  })();
}

async function collect(gen) {
  const out = [];
  for await (const e of gen) out.push(e);
  return out;
}

test("decodeSseStream: parses SSE data frames", async () => {
  const events = await collect(
    decodeSseStream(byteStreamOf(['data: {"type":"token","text":"hi"}\n\n', 'data: {"type":"done"}\n\n'])),
  );
  assert.deepEqual(events, [
    { type: "token", text: "hi" },
    { type: "done" },
  ]);
});

test("decodeSseStream: converts a single JSON answer blob to token + citation events", async () => {
  const blob = JSON.stringify({
    answer: "Rotate the key per the runbook.",
    grounded: true,
    citations: [{ source_path: "ops/key-rotation.md", score: 0.9 }],
  });
  const events = await collect(decodeSseStream(byteStreamOf([blob])));
  assert.deepEqual(events, [
    { type: "token", text: "Rotate the key per the runbook." },
    { type: "citation", source_path: "ops/key-rotation.md", score: 0.9 },
  ]);
});

test("decodeSseStream: a JSON blob split across chunks still decodes", async () => {
  const blob = JSON.stringify({ answer: "hello", citations: [] });
  const mid = Math.floor(blob.length / 2);
  const events = await collect(decodeSseStream(byteStreamOf([blob.slice(0, mid), blob.slice(mid)])));
  assert.deepEqual(events, [{ type: "token", text: "hello" }]);
});

test("decodeSseStream: non-JSON, non-SSE body is surfaced as a token", async () => {
  const events = await collect(decodeSseStream(byteStreamOf(["plain text answer"])));
  assert.deepEqual(events, [{ type: "token", text: "plain text answer" }]);
});

test("normalizeRuntimeSessionId: pads short ids to AgentCore's 33-char floor, clamps long", () => {
  // A slug-derived plan session ("plan-mc-testflight" = 18) must be padded, not rejected.
  const padded = normalizeRuntimeSessionId("plan-mc-testflight");
  assert.equal(padded.length, 33);
  assert.ok(padded.startsWith("plan-mc-testflight")); // deterministic + stable prefix
  assert.equal(normalizeRuntimeSessionId("plan-mc-testflight"), padded); // same input -> same id
  // Already-valid ids pass through untouched; over-long ids clamp to 100.
  const ok = "web-123e4567-e89b-12d3-a456-426614174000";
  assert.equal(normalizeRuntimeSessionId(ok), ok);
  assert.equal(normalizeRuntimeSessionId("x".repeat(150)).length, 100);
});

test("invokeAgentRuntimeStream: sends a normalized (>=33) runtimeSessionId, payload keeps the original", async () => {
  let seen = null;
  const client = {
    async invoke(args) {
      seen = args;
      return { stream: (async function* () {})() };
    },
  };
  await collect(
    invokeAgentRuntimeStream(client, {
      runtimeArn: "arn:x",
      sessionId: "plan-mc-testflight", // 18 chars -> would 400 without normalization
      userId: "u1",
      tenantId: "homebase",
      prompt: "revise",
    }),
  );
  assert.equal(seen.sessionId.length, 33); // AgentCore constraint satisfied
  assert.equal(JSON.parse(seen.body).session_id, "plan-mc-testflight"); // memory keying unchanged
});

test("invokeAgentRuntimeStream: includes plan_context in the payload only when set", async () => {
  const seen = [];
  const client = {
    async invoke(args) {
      seen.push(JSON.parse(args.body));
      return { stream: (async function* () {})() };
    },
  };
  await collect(
    invokeAgentRuntimeStream(client, {
      runtimeArn: "arn:x",
      sessionId: "plan-ship",
      userId: "u1",
      tenantId: "homebase",
      prompt: "revise",
      mode: "plan",
      planContext: '{"title":"Ship"}',
    }),
  );
  assert.equal(seen[0].plan_context, '{"title":"Ship"}');
  assert.equal(seen[0].mode, "plan");

  await collect(
    invokeAgentRuntimeStream(client, { runtimeArn: "arn:x", sessionId: "s", userId: "u1", tenantId: "homebase", prompt: "hi" }),
  );
  assert.equal("plan_context" in seen[1], false);
});

test("invokeAgentRuntimeStream: includes author_context in the payload only when set", async () => {
  const seen = [];
  const client = {
    async invoke(args) {
      seen.push(JSON.parse(args.body));
      return { stream: (async function* () {})() };
    },
  };
  await collect(
    invokeAgentRuntimeStream(client, {
      runtimeArn: "arn:x",
      sessionId: "doc-adr-session-000000000000000",
      userId: "u1",
      tenantId: "homebase",
      prompt: "draft it",
      mode: "author",
      authorContext: '{"path":"ai/adr/x.md","template":"# {{title}}"}',
    }),
  );
  assert.equal(seen[0].author_context, '{"path":"ai/adr/x.md","template":"# {{title}}"}');
  assert.equal(seen[0].mode, "author");

  await collect(
    invokeAgentRuntimeStream(client, { runtimeArn: "arn:x", sessionId: "s", userId: "u1", tenantId: "homebase", prompt: "hi" }),
  );
  assert.equal("author_context" in seen[1], false);
});
