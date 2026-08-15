import { describe, expect, it, vi } from "vitest";

import { makeMissionsApi, parseSse } from "../missions/api";

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: "", text: async () => JSON.stringify(body) } as unknown as Response;
}

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
}

describe("makeMissionsApi", () => {
  it("launches a run with the bearer token and mapped body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonRes({ run_id: "r1", status: "queued" });
    }) as unknown as typeof fetch;
    const api = makeMissionsApi("https://api.example", async () => "tok", fetchImpl);
    const run = await api.launch({ target: "https://github.com/x/y.git", taskType: "sim", prompt: "look" });
    expect(run.run_id).toBe("r1");
    expect(calls[0].url).toBe("https://api.example/api/missions/runs");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ target: "https://github.com/x/y.git", task_type: "sim", prompt: "look" });
  });

  it("list unwraps {runs:[...]} or a bare array", async () => {
    const wrapped = makeMissionsApi("https://a", async () => "t", (async () => jsonRes({ runs: [{ run_id: "a", status: "done" }] })) as unknown as typeof fetch);
    expect((await wrapped.list()).length).toBe(1);
    const bare = makeMissionsApi("https://a", async () => "t", (async () => jsonRes([{ run_id: "b", status: "done" }])) as unknown as typeof fetch);
    expect((await bare.list())[0].run_id).toBe("b");
  });

  it("decide posts the gate action to the run", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return jsonRes({ ok: true });
    }) as unknown as typeof fetch;
    const api = makeMissionsApi("https://a", async () => "t", fetchImpl);
    await api.decide("r1", "approve");
    expect(calls[0]).toBe("https://a/api/missions/runs/r1/approve");
  });

  it("surfaces an error body message", async () => {
    const api = makeMissionsApi("https://a", async () => "t", (async () => jsonRes({ message: "nope" }, false, 502)) as unknown as typeof fetch);
    await expect(api.get("r1")).rejects.toThrow("nope");
  });
});

describe("parseSse", () => {
  it("parses data-only frames split across chunks, skipping keepalives", async () => {
    const out = [];
    for await (const e of parseSse(sseBody([": open\n\n", 'data: {"type":"node_transition","data":{"nod', 'e":"dispatch"}}\n\n', ": keepalive\n\n", 'data: {"type":"gate_waiting","data":{}}\n\n']))) {
      out.push(e);
    }
    expect(out).toEqual([
      { type: "node_transition", data: { node: "dispatch" } },
      { type: "gate_waiting", data: {} },
    ]);
  });

  it("events() streams the run's telemetry", async () => {
    const api = makeMissionsApi("https://a", async () => "t", (async () => ({ ok: true, status: 200, body: sseBody(['data: {"type":"step_metric","data":{"cost_usd":0.002}}\n\n']) })) as unknown as typeof fetch);
    const out = [];
    for await (const e of api.events("r1")) out.push(e);
    expect(out).toEqual([{ type: "step_metric", data: { cost_usd: 0.002 } }]);
  });
});
