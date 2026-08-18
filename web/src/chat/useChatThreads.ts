import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { UseChat } from "./useChat";
import { makeThreadsApi, toChatMessages, toStoredMessages, type ThreadSummary } from "./threadsApi";

export interface UseChatThreads {
  threads: ThreadSummary[];
  activeId: string;
  refresh: () => Promise<void>;
  selectThread: (id: string) => Promise<void>;
  newThread: () => void;
}

// Orchestrates chat thread memory over useChat: lists saved threads, auto-saves
// the current thread when an exchange completes, and loads/creates threads. Saving
// writes a vault note (git-versioned + KB-indexed); the BFF prunes old threads.
export function useChatThreads(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  chat: UseChat,
  getScope: () => "vault" | "general",
  enabled: boolean,
  fetchImpl?: typeof fetch,
): UseChatThreads {
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const api = useMemo(() => makeThreadsApi(apiBaseUrl, () => getTokenRef.current(), fetchImpl), [apiBaseUrl, fetchImpl]);

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const prevStreaming = useRef(chat.streaming);

  const refresh = useCallback(async () => {
    try {
      setThreads(await api.list());
    } catch {
      /* memory not enabled / unreachable: leave the list empty */
    }
  }, [api]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  // Auto-save when streaming finishes (an exchange completed), then refresh the
  // list. Guarded so we only save real, non-empty threads.
  useEffect(() => {
    const justFinished = prevStreaming.current && !chat.streaming;
    prevStreaming.current = chat.streaming;
    if (!justFinished) return;
    const stored = toStoredMessages(chat.messages);
    if (stored.length < 2) return; // need at least a user + assistant turn
    const id = chat.sessionId;
    void (async () => {
      try {
        await api.save(id, { scope: getScope(), messages: stored });
        await refresh();
      } catch {
        /* best effort: a failed save should never disrupt the chat */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.streaming]);

  const selectThread = useCallback(
    async (id: string) => {
      if (id === chat.sessionId) return;
      try {
        const detail = await api.get(id);
        chat.loadThread(id, toChatMessages(detail.messages));
      } catch {
        /* thread gone (pruned): refresh the list */
        void refresh();
      }
    },
    [api, chat, refresh],
  );

  const newThread = useCallback(() => {
    chat.newThread();
  }, [chat]);

  return { threads, activeId: chat.sessionId, refresh, selectThread, newThread };
}
