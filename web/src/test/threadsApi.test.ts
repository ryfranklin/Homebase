import { describe, expect, it, vi } from "vitest";

import { makeThreadsApi, toChatMessages, toStoredMessages } from "../chat/threadsApi";
import type { ChatMessage } from "../chat/messages";

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: "", text: async () => JSON.stringify(body) } as unknown as Response;
}

describe("makeThreadsApi", () => {
  it("lists threads (unwrapping {threads:[...]}) with the bearer token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonRes({ threads: [{ id: "web-1", title: "S3 Vectors", scope: "vault", updated: "t" }] });
    }) as unknown as typeof fetch;
    const api = makeThreadsApi("https://api.example", async () => "tok", fetchImpl);
    const threads = await api.list();
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe("web-1");
    expect(calls[0].url).toBe("https://api.example/api/chat/threads");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("saves a thread with PUT and the serialized body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonRes({ ok: true, id: "web-1", title: "t", updated: "t" });
    }) as unknown as typeof fetch;
    const api = makeThreadsApi("https://a", async () => "t", fetchImpl);
    await api.save("web-1", { scope: "vault", messages: [{ role: "user", text: "hi" }] });
    expect(calls[0].url).toBe("https://a/api/chat/threads/web-1");
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(calls[0].init.body as string).messages[0].text).toBe("hi");
  });
});

describe("message conversion", () => {
  it("drops streaming/empty messages when storing", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "user", text: "q", citations: [], toolEvents: [], streaming: false },
      { id: "2", role: "assistant", text: "a", citations: [], toolEvents: [], streaming: false },
      { id: "3", role: "assistant", text: "", citations: [], toolEvents: [], streaming: true },
    ];
    const stored = toStoredMessages(msgs);
    expect(stored).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "a" },
    ]);
  });

  it("hydrates stored messages back into non-streaming ChatMessages", () => {
    const chat = toChatMessages([{ role: "user", text: "q" }, { role: "assistant", text: "a" }]);
    expect(chat).toHaveLength(2);
    expect(chat[0]).toMatchObject({ role: "user", text: "q", streaming: false });
  });
});
