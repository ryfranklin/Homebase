// Typed client for the streaming BFF endpoint.
//
// It uses fetch + ReadableStream, NOT EventSource. EventSource cannot issue a
// POST and cannot send an Authorization header, both of which this endpoint
// needs (the prompt is POSTed and the Cognito bearer token is required). So we
// POST with fetch and read the SSE body from response.body.

import type { ChatRequest, StreamEvent } from "./types";

export interface StreamOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export class StreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StreamError";
    this.status = status;
  }
}

// streamChat POSTs the prompt with the bearer token and yields parsed SSE events.
export async function* streamChat(
  apiBaseUrl: string,
  accessToken: string,
  req: ChatRequest,
  opts: StreamOptions = {},
): AsyncGenerator<StreamEvent> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${apiBaseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      input: req.input,
      session_id: req.sessionId,
      ...(req.mode ? { mode: req.mode } : {}),
      ...(req.model ? { model: req.model } : {}),
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    throw new StreamError(res.status, `stream request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice("data:".length).trim();
        try {
          yield JSON.parse(json) as StreamEvent;
        } catch {
          // Ignore keep-alive comments / malformed frames.
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}
