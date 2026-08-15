import { describe, expect, it, vi } from "vitest";

import { searchConfluence, confluenceToVaultDoc } from "../plan/confluence";

describe("confluence client", () => {
  it("searches via the BFF with the bearer token and the query", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ results: [{ id: "1", title: "Design", url: "u", excerpt: "e" }] }) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchImpl);
    const out = await searchConfluence("https://api.example", async () => "tok", "relay");
    expect(calls[0].url).toBe("https://api.example/api/plan/confluence/search?q=relay");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(out[0].title).toBe("Design");
    vi.unstubAllGlobals();
  });

  it("maps a page to a confluence-origin vault doc", () => {
    const doc = confluenceToVaultDoc({ id: "42", title: "Relay design", url: "https://x/42", excerpt: "canvas" });
    expect(doc).toMatchObject({ slug: "cf-42", origin: "confluence", kind: "design", externalUrl: "https://x/42", title: "Relay design" });
  });
});
