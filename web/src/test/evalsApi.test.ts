import { describe, expect, it, vi } from "vitest";

import { makeEvalsApi } from "../evals/api";

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: "", text: async () => JSON.stringify(body) } as unknown as Response;
}

describe("makeEvalsApi", () => {
  it("lists runs with the bearer token, unwrapping {runs:[...]}", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonRes({ runs: [{ runId: "r1", suite: "gen-hard", judge: "j", createdAt: "t", status: "complete" }] });
    }) as unknown as typeof fetch;
    const api = makeEvalsApi("https://api.example", async () => "tok", fetchImpl);
    const runs = await api.list();
    expect(runs.length).toBe(1);
    expect(runs[0].runId).toBe("r1");
    expect(calls[0].url).toBe("https://api.example/api/evals/runs");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("fetches one run payload by id (url-encoded)", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonRes({ meta: { suite: "gen-hard" }, scorecards: [], tags: [], cases: [] });
    }) as unknown as typeof fetch;
    const api = makeEvalsApi("https://a", async () => "t", fetchImpl);
    const run = await api.get("run 1");
    expect(run.meta.suite).toBe("gen-hard");
    expect(calls[0]).toBe("https://a/api/evals/runs/run%201");
  });

  it("throws the server error message on a non-ok response", async () => {
    const fetchImpl = (async () => jsonRes({ error: "evals_unconfigured", message: "not enabled" }, false, 503)) as unknown as typeof fetch;
    const api = makeEvalsApi("https://a", async () => "t", fetchImpl);
    await expect(api.list()).rejects.toThrow("not enabled");
  });
});
