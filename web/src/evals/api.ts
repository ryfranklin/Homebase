// Authed client for the BFF's eval routes (/api/evals/*). Mirrors the vault/chat/
// missions clients: every call carries a fresh bearer token. The BFF serves the
// run payload the harness wrote to S3, so no reconstruction happens here.

import fixtureJson from "./fixture.json";
import type { RunPayload, RunSummary } from "./types";

async function authed<T>(apiBaseUrl: string, token: string, path: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${apiBaseUrl}/api/evals/${path}`, {
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
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

export interface EvalsApi {
  list(): Promise<RunSummary[]>;
  get(id: string): Promise<RunPayload>;
}

export function makeEvalsApi(apiBaseUrl: string, getToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): EvalsApi {
  const q = (s: string) => encodeURIComponent(s);
  const call = async <T>(path: string) => authed<T>(apiBaseUrl, await getToken(), path, fetchImpl);
  return {
    list: () => call<{ runs?: RunSummary[] } | RunSummary[]>("runs").then((r) => (Array.isArray(r) ? r : (r.runs ?? []))),
    get: (id) => call<RunPayload>(`runs/${q(id)}`),
  };
}

// A bundled sample run (real hard-suite output) so the tab is usable before the
// eval stack is deployed or when the BFF has no runs yet.
export const SAMPLE_PAYLOAD = fixtureJson as unknown as RunPayload;

export const SAMPLE_SUMMARY: RunSummary = {
  runId: "sample",
  suite: SAMPLE_PAYLOAD.meta.suite,
  judge: SAMPLE_PAYLOAD.meta.judge,
  createdAt: SAMPLE_PAYLOAD.meta.generated_at,
  status: "sample",
  topModel: SAMPLE_PAYLOAD.scorecards[0]?.model,
  topQuality: SAMPLE_PAYLOAD.scorecards[0]?.avg_quality,
  nModels: SAMPLE_PAYLOAD.scorecards.length,
};
