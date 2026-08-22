// Authed client for the BFF's Mission Control routes (/api/missions/*). Mirrors the
// vault/chat clients: every call carries a fresh bearer token. Run telemetry is an
// SSE stream read with fetch + ReadableStream (EventSource cannot send the bearer).

import type { LaunchInput, Run, RunChanges, RunEvent } from "./types";

async function authed<T>(apiBaseUrl: string, token: string, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${apiBaseUrl}/api/missions/${path}`, {
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

export interface MissionsApi {
  launch(input: LaunchInput): Promise<Run>;
  // Launch a flight-plan unit: the BFF maps { plan, unit } to a run (task_type from
  // the unit's phase, prompt composed from the plan narrative + approved criteria).
  launchUnit(plan: unknown, unit: unknown): Promise<Run>;
  list(): Promise<Run[]>;
  get(id: string): Promise<Run>;
  // The diff a burn produced (for review at the gate). Empty until the worker commits.
  changes(id: string): Promise<RunChanges>;
  decide(id: string, decision: "approve" | "reject" | "scrub" | "cancel"): Promise<{ ok?: boolean }>;
  events(id: string, opts?: { signal?: AbortSignal }): AsyncGenerator<RunEvent>;
}

export function makeMissionsApi(apiBaseUrl: string, getToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): MissionsApi {
  const call = async <T>(path: string, init: RequestInit = {}) => authed<T>(apiBaseUrl, await getToken(), path, init, fetchImpl);
  const q = (s: string) => encodeURIComponent(s);
  return {
    launch: (input) =>
      call<Run>("runs", { method: "POST", body: JSON.stringify({ target: input.target, task_type: input.taskType, prompt: input.prompt }) }),
    launchUnit: (plan, unit) => call<Run>("runs", { method: "POST", body: JSON.stringify({ plan, unit }) }),
    list: () => call<{ runs?: Run[] } | Run[]>("runs").then((r) => (Array.isArray(r) ? r : (r.runs ?? []))),
    get: (id) => call<Run>(`runs/${q(id)}`),
    changes: (id) => call<RunChanges>(`runs/${q(id)}/changes`),
    decide: (id, decision) => call(`runs/${q(id)}/${decision}`, { method: "POST" }),
    async *events(id, opts = {}) {
      const token = await getToken();
      const res = await fetchImpl(`${apiBaseUrl}/api/missions/runs/${q(id)}/events`, {
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
        signal: opts.signal,
      });
      if (!res.ok || !res.body) throw new Error(`telemetry stream failed: ${res.status}`);
      yield* parseSse(res.body);
    },
  };
}

// Parse data-only SSE frames ({ "type": ..., ... }) from a ReadableStream, tolerant
// of frames split across chunks and of keepalive comment lines.
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<RunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = frameData(frame);
        if (data !== null) yield data;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

function frameData(frame: string): RunEvent | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // keepalive/comment
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n")) as RunEvent;
  } catch {
    return null;
  }
}
