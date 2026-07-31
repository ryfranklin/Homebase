import { useCallback, useRef, useState } from "react";

import { streamChat } from "../api/sseClient";
import { applyEvent, type ChatMessage } from "./messages";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `m${counter}`;
}

export interface UseChat {
  messages: ChatMessage[];
  streaming: boolean;
  send: (input: string) => Promise<void>;
  stop: () => void;
}

// getToken returns a fresh (refreshed if needed) access token for each send, so
// the Authorization bearer is always valid on the streaming fetch call.
export function useChat(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  fetchImpl?: typeof fetch,
): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed || streaming) return;

      const assistantId = nextId();
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: trimmed, citations: [], toolEvents: [], streaming: false },
        { id: assistantId, role: "assistant", text: "", citations: [], toolEvents: [], streaming: true },
      ]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = await getToken();
        for await (const event of streamChat(
          apiBaseUrl,
          token,
          { input: trimmed },
          { signal: controller.signal, fetchImpl },
        )) {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? applyEvent(m, event) : m)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "stream error";
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, error: message, streaming: false } : m)),
        );
      } finally {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)));
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [apiBaseUrl, getToken, fetchImpl, streaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, streaming, send, stop };
}
