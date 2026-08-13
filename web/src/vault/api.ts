import type { Backlink, Note, SearchResult, TreeNode } from "./types";

// Thin authed client for the vault routes. Mirrors the chat/connector fetch
// pattern: every call carries a fresh bearer token and hits `${apiBaseUrl}/api/vault/*`.

async function authed<T>(
  apiBaseUrl: string,
  token: string,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(`${apiBaseUrl}/api/vault/${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message || body.error || message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface VaultApi {
  tree(): Promise<{ tree: TreeNode[]; count: number }>;
  get(key: string): Promise<Note>;
  put(key: string, content: string): Promise<{ ok: true; key: string; title: string }>;
  remove(key: string): Promise<{ ok: true; key: string }>;
  search(q: string): Promise<{ results: SearchResult[] }>;
  backlinks(key: string): Promise<{ backlinks: Backlink[] }>;
}

export function makeVaultApi(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): VaultApi {
  const call = async <T>(path: string, init: RequestInit = {}) =>
    authed<T>(apiBaseUrl, await getToken(), path, init, fetchImpl);
  const q = (key: string) => encodeURIComponent(key);
  return {
    tree: () => call("tree"),
    get: (key) => call(`note?key=${q(key)}`),
    put: (key, content) => call("note", { method: "PUT", body: JSON.stringify({ key, content }) }),
    remove: (key) => call(`note?key=${q(key)}`, { method: "DELETE" }),
    search: (query) => call(`search?q=${q(query)}`),
    backlinks: (key) => call(`backlinks?key=${q(key)}`),
  };
}
