import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useVault } from "../vault/useVault";

// Regression: useVault runs at the App top level (before login). It must NOT load the
// tree until authenticated, or getToken() throws "not authenticated" and the vault is
// stuck on that stale error. It should load the moment `enabled` flips to true.
describe("useVault load gating", () => {
  it("defers the tree load until enabled, then loads on the transition", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return { ok: true, text: async () => JSON.stringify({ tree: [], count: 0 }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const { rerender } = renderHook(({ enabled }) => useVault("https://api.example", async () => "tok", undefined, enabled, fetchImpl), {
      initialProps: { enabled: false },
    });

    // Not authenticated yet: no request should have been made.
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((u) => u.includes("/api/vault/tree"))).toBe(false);

    // Authenticated: the tree loads.
    rerender({ enabled: true });
    await waitFor(() => expect(calls.some((u) => u.includes("/api/vault/tree"))).toBe(true));
  });
});
