import { useCallback, useRef, useState } from "react";

import { streamChat } from "../api/sseClient";
import { applyEvent, type ChatMessage } from "./messages";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `m${counter}`;
}

// Per-send overrides. Author mode drives the guided document-authoring session: each
// turn carries mode "author" and the evolving document as authorContext (JSON).
export interface SendOptions {
  mode?: "author";
  authorContext?: string;
}

export interface UseChat {
  messages: ChatMessage[];
  streaming: boolean;
  send: (input: string, opts?: SendOptions) => Promise<void>;
  stop: () => void;
  // The current thread (chat session) id, used as the vault note key for memory.
  sessionId: string;
  // Start a fresh thread: new session id, empty transcript.
  newThread: () => void;
  // Load a saved thread's messages under its id, so replies append to it.
  loadThread: (id: string, messages: ChatMessage[]) => void;
}

// getToken returns a fresh (refreshed if needed) access token for each send, so
// the Authorization bearer is always valid on the streaming fetch call.
// A session id generated once per page load. Sending an explicit, rotating session
// id (rather than letting the BFF fall back to a stable tenant:user id) means a
// reload starts a fresh agent session — which also stops the request from being
// pinned to a stale warm runtime instance after a deploy. AgentCore requires the
// runtime session id to be reasonably long, so the "web-" + uuid form is safe.
function newSessionId(): string {
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}-${Math.floor(Math.random() * 1e9)}`;
  return `web-${uuid}`;
}

// getModel returns the settings-level default model id to send with each message
// (undefined -> the agent's deploy-time default). Read fresh per send so changing
// the selection takes effect immediately without re-creating the hook.
export function useChat(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  fetchImpl?: typeof fetch,
  getModel?: () => string | undefined,
  // getScope returns the chat scope ("vault" | "general"), read fresh per send so
  // flipping the Vault chat toggle takes effect immediately.
  getScope?: () => "vault" | "general" | undefined,
): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(newSessionId());
  // Mirror the session id into state so the UI (thread list, "new chat") re-renders
  // when it changes; sends still read the ref for the current value.
  const [sessionId, setSessionId] = useState<string>(sessionIdRef.current);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    const id = newSessionId();
    sessionIdRef.current = id;
    setSessionId(id);
    setMessages([]);
    setStreaming(false);
  }, []);

  const loadThread = useCallback((id: string, loaded: ChatMessage[]) => {
    abortRef.current?.abort();
    sessionIdRef.current = id;
    setSessionId(id);
    setMessages(loaded);
    setStreaming(false);
  }, []);

  const send = useCallback(
    async (input: string, opts?: SendOptions) => {
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
          {
            input: trimmed,
            sessionId: sessionIdRef.current,
            model: getModel?.(),
            scope: getScope?.(),
            ...(opts?.mode ? { mode: opts.mode } : {}),
            ...(opts?.authorContext ? { authorContext: opts.authorContext } : {}),
          },
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
    [apiBaseUrl, getToken, fetchImpl, getModel, getScope, streaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, streaming, send, stop, sessionId, newThread, loadThread };
}
