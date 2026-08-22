import { describe, expect, it } from "vitest";

import { streamChat, StreamError } from "../api/sseClient";
import type { StreamEvent } from "../api/types";

// Build a Response whose body is a ReadableStream emitting the given SSE chunks,
// so we exercise the fetch + ReadableStream path (not EventSource).
function sseResponse(chunks: string[], init: { ok?: boolean; status?: number } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    body,
  } as unknown as Response;
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("streamChat", () => {
  it("parses SSE frames split across chunks", async () => {
    const fetchImpl = async () =>
      sseResponse([
        'data: {"type":"token","text":"Hel"}\n\n',
        'data: {"type":"token","text":"lo"}\n\ndata: {"type":"citation","source_path":"ops/x.md"}\n\n',
        'data: {"type":"done"}\n\n',
      ]);

    const events = await collect(
      streamChat("https://app.example.invalid", "token-abc", { input: "hi" }, { fetchImpl: fetchImpl as typeof fetch }),
    );

    expect(events).toEqual([
      { type: "token", text: "Hel" },
      { type: "token", text: "lo" },
      { type: "citation", source_path: "ops/x.md" },
      { type: "done" },
    ]);
  });

  it("sends POST with Authorization bearer and JSON body", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return sseResponse(['data: {"type":"done"}\n\n']);
    }) as unknown as typeof fetch;

    await collect(streamChat("https://app.example.invalid", "token-abc", { input: "hi" }, { fetchImpl }));

    expect(captured!.url).toBe("https://app.example.invalid/api/chat");
    expect(captured!.init.method).toBe("POST");
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-abc");
    expect(JSON.parse(captured!.init.body as string)).toEqual({ input: "hi", session_id: undefined });
  });

  it("includes model in the body only when set", async () => {
    let captured: RequestInit | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      captured = init;
      return sseResponse(['data: {"type":"done"}\n\n']);
    }) as unknown as typeof fetch;

    await collect(streamChat("https://app.example.invalid", "t", { input: "hi", model: "model-b" }, { fetchImpl }));
    expect(JSON.parse(captured!.body as string)).toMatchObject({ model: "model-b" });

    captured = null;
    await collect(streamChat("https://app.example.invalid", "t", { input: "hi" }, { fetchImpl }));
    expect("model" in JSON.parse(captured!.body as string)).toBe(false);
  });

  it("sends plan_context (revise mode) only when set", async () => {
    let captured: RequestInit | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      captured = init;
      return sseResponse(['data: {"type":"done"}\n\n']);
    }) as unknown as typeof fetch;

    await collect(
      streamChat("https://app.example.invalid", "t", { input: "revise it", mode: "plan", planContext: '{"title":"Ship"}' }, { fetchImpl }),
    );
    expect(JSON.parse(captured!.body as string)).toMatchObject({ mode: "plan", plan_context: '{"title":"Ship"}' });

    captured = null;
    await collect(streamChat("https://app.example.invalid", "t", { input: "hi", mode: "plan" }, { fetchImpl }));
    expect("plan_context" in JSON.parse(captured!.body as string)).toBe(false);
  });

  it("sends author_context (author mode) only when set", async () => {
    let captured: RequestInit | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      captured = init;
      return sseResponse(['data: {"type":"done"}\n\n']);
    }) as unknown as typeof fetch;

    await collect(
      streamChat(
        "https://app.example.invalid",
        "t",
        { input: "draft it", mode: "author", authorContext: '{"path":"ai/adr/x.md"}' },
        { fetchImpl },
      ),
    );
    expect(JSON.parse(captured!.body as string)).toMatchObject({ mode: "author", author_context: '{"path":"ai/adr/x.md"}' });

    captured = null;
    await collect(streamChat("https://app.example.invalid", "t", { input: "hi", mode: "author" }, { fetchImpl }));
    expect("author_context" in JSON.parse(captured!.body as string)).toBe(false);
  });

  it("throws StreamError on a non-ok response", async () => {
    const fetchImpl = (async () => sseResponse([], { ok: false, status: 401 })) as unknown as typeof fetch;
    await expect(
      collect(streamChat("https://app.example.invalid", "t", { input: "hi" }, { fetchImpl })),
    ).rejects.toBeInstanceOf(StreamError);
  });

  it("uses fetch + ReadableStream, never EventSource", async () => {
    // Guard the streaming-client gotcha: EventSource cannot POST or set headers.
    const { readFileSync } = await import("node:fs");
    // cwd is the web/ package root under vitest.
    const source = readFileSync("src/api/sseClient.ts", "utf8");
    // The client must not instantiate EventSource (it cannot POST or set headers).
    expect(source).not.toMatch(/new\s+EventSource/);
    expect(source).toMatch(/getReader\(\)/);
  });
});
