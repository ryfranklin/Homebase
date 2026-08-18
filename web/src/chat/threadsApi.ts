// Client for the BFF chat-thread memory routes (/api/chat/threads/*). Threads are
// stored as vault notes (KB-indexed) and pruned after the retention window; this
// client lists, loads, saves, and deletes them.

import type { ChatMessage } from "./messages";

export interface StoredMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  scope: string;
  updated: string;
}

export interface ThreadDetail extends ThreadSummary {
  messages: StoredMessage[];
}

async function authed<T>(apiBaseUrl: string, token: string, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${apiBaseUrl}/api/chat/${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = JSON.parse(text);
      message = body.message || body.error || message;
    } catch {
      /* non-JSON */
    }
    throw new Error(message);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface ThreadsApi {
  list(): Promise<ThreadSummary[]>;
  get(id: string): Promise<ThreadDetail>;
  save(id: string, body: { title?: string; scope: string; messages: StoredMessage[] }): Promise<{ ok: boolean; id: string; title: string; updated: string }>;
  remove(id: string): Promise<{ ok: boolean }>;
}

export function makeThreadsApi(apiBaseUrl: string, getToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): ThreadsApi {
  const q = (s: string) => encodeURIComponent(s);
  const call = async <T>(path: string, init: RequestInit = {}) => authed<T>(apiBaseUrl, await getToken(), path, init, fetchImpl);
  return {
    list: () => call<{ threads?: ThreadSummary[] } | ThreadSummary[]>("threads").then((r) => (Array.isArray(r) ? r : (r.threads ?? []))),
    get: (id) => call<ThreadDetail>(`threads/${q(id)}`),
    save: (id, body) => call(`threads/${q(id)}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id) => call(`threads/${q(id)}`, { method: "DELETE" }),
  };
}

let loadCounter = 0;

// Convert stored thread messages into UI ChatMessages (non-streaming, no citations).
export function toChatMessages(stored: StoredMessage[]): ChatMessage[] {
  return stored.map((m) => {
    loadCounter += 1;
    return { id: `t${loadCounter}`, role: m.role, text: m.text, citations: [], toolEvents: [], streaming: false };
  });
}

// Convert UI ChatMessages into stored messages (drop empty / still-streaming ones).
export function toStoredMessages(messages: ChatMessage[]): StoredMessage[] {
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && !m.streaming && (m.text ?? "").trim())
    .map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
}
