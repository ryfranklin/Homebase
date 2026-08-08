import { describe, expect, it } from "vitest";

import { completeConnectorAuth } from "../connectors/completeAuth";

describe("completeConnectorAuth", () => {
  it("POSTs the session_id with the bearer token to /api/connectors/complete", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    await completeConnectorAuth("https://app.example.invalid", "token-abc", "urn:sess:1", fetchImpl);

    expect(captured!.url).toBe("https://app.example.invalid/api/connectors/complete");
    expect(captured!.init.method).toBe("POST");
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-abc");
    expect(JSON.parse(captured!.init.body as string)).toEqual({ session_id: "urn:sess:1" });
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 502 }) as Response) as unknown as typeof fetch;
    await expect(
      completeConnectorAuth("https://app.example.invalid", "t", "urn:sess:1", fetchImpl),
    ).rejects.toThrow(/502/);
  });
});
