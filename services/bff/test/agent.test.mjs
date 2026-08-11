import test from "node:test";
import assert from "node:assert/strict";

import { decodeSseStream } from "../src/agent.mjs";

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
