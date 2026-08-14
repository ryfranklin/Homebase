import { describe, expect, it, vi } from "vitest";

import { makeVaultApi } from "../vault/api";

function okFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      async text() {
        return JSON.stringify({ ok: true, key: "n.md", title: "n" });
      },
    } as unknown as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("makeVaultApi", () => {
  it("sends the bearer access token and the id token for attribution", async () => {
    const { fetchImpl, calls } = okFetch();
    const api = makeVaultApi(
      "https://api.example",
      async () => "access-tok",
      async () => "id-tok",
      fetchImpl,
    );
    await api.put("n.md", "# hi");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer access-tok");
    expect(headers["x-id-token"]).toBe("id-tok");
  });

  it("omits x-id-token when no id-token accessor is provided", async () => {
    const { fetchImpl, calls } = okFetch();
    const api = makeVaultApi("https://api.example", async () => "access-tok", undefined, fetchImpl);
    await api.put("n.md", "# hi");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer access-tok");
    expect("x-id-token" in headers).toBe(false);
  });
});
