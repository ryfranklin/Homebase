import type { Backlink, Note, NoteVersion, SearchResult, TemplateMeta, TreeNode } from "./types";

// Thin authed client for the vault routes. Mirrors the chat/connector fetch
// pattern: every call carries a fresh bearer token and hits `${apiBaseUrl}/api/vault/*`.

async function authed<T>(
  apiBaseUrl: string,
  token: string,
  idToken: string | null,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(`${apiBaseUrl}/api/vault/${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      // The BFF reads the ID token's profile claims to attribute writes to a person.
      ...(idToken ? { "x-id-token": idToken } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = JSON.parse(text);
      message = body.message || body.error || message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // A non-JSON 200 (e.g. the chat SSE stream) means the vault routes are not
    // served yet - the api stack needs to be applied to deploy the new BFF.
    throw new Error("The vault API is not available yet. Deploy the api stack (terraform -chdir=infra/stacks/api apply).");
  }
}

export interface VaultApi {
  tree(): Promise<{ tree: TreeNode[]; count: number }>;
  templates(): Promise<{ templates: TemplateMeta[]; count: number }>;
  get(key: string): Promise<Note>;
  put(key: string, content: string): Promise<{ ok: true; key: string; title: string }>;
  remove(key: string): Promise<{ ok: true; key: string }>;
  removeDir(prefix: string): Promise<{ ok: boolean; prefix: string; deletedCount: number; failed: string[] }>;
  search(q: string): Promise<{ results: SearchResult[] }>;
  backlinks(key: string): Promise<{ backlinks: Backlink[] }>;
  history(key: string): Promise<{ key: string; versions: NoteVersion[] }>;
  restore(key: string, versionId: string): Promise<{ ok: true; key: string }>;
}

export function makeVaultApi(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  getIdToken?: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): VaultApi {
  const call = async <T>(path: string, init: RequestInit = {}) => {
    const [token, idToken] = await Promise.all([getToken(), getIdToken?.() ?? Promise.resolve(null)]);
    return authed<T>(apiBaseUrl, token, idToken, path, init, fetchImpl);
  };
  const q = (key: string) => encodeURIComponent(key);
  return {
    tree: () => call("tree"),
    templates: () => call("templates"),
    get: (key) => call(`note?key=${q(key)}`),
    put: (key, content) => call("note", { method: "PUT", body: JSON.stringify({ key, content }) }),
    remove: (key) => call(`note?key=${q(key)}`, { method: "DELETE" }),
    removeDir: (prefix) => call(`dir?prefix=${q(prefix)}`, { method: "DELETE" }),
    search: (query) => call(`search?q=${q(query)}`),
    backlinks: (key) => call(`backlinks?key=${q(key)}`),
    history: (key) => call(`history?key=${q(key)}`),
    restore: (key, versionId) => call("restore", { method: "POST", body: JSON.stringify({ key, versionId }) }),
  };
}
