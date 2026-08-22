import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { makeVaultApi } from "./api";
import { flattenKeys, resolveWikilink } from "./resolve";
import type { Backlink, Note, NoteVersion, SearchResult, TreeNode } from "./types";

export type VaultStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

export interface UseVault {
  tree: TreeNode[];
  count: number;
  keys: string[];
  note: Note | null;
  draft: string;
  editing: boolean;
  dirty: boolean;
  backlinks: Backlink[];
  status: VaultStatus;
  results: SearchResult[] | null;
  history: NoteVersion[] | null;
  setDraft: (v: string) => void;
  setEditing: (v: boolean) => void;
  open: (key: string) => Promise<void>;
  openWikilink: (target: string) => void;
  save: () => Promise<void>;
  create: (key: string, content?: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  removeDir: (prefix: string) => Promise<void>;
  search: (q: string) => Promise<void>;
  clearSearch: () => void;
  loadHistory: () => Promise<void>;
  restore: (versionId: string) => Promise<void>;
  clearHistory: () => void;
  refreshTree: () => Promise<void>;
}

// Vault workspace state: the tree, the open note (+ its editable draft and
// backlinks), search results, and status. All server calls go through the vault
// API; getToken is read via a ref so the API instance stays stable across renders.
export function useVault(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  getIdToken?: () => Promise<string>,
  enabled: boolean = true,
  fetchImpl: typeof fetch = fetch,
): UseVault {
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const getIdTokenRef = useRef(getIdToken);
  getIdTokenRef.current = getIdToken;
  const api = useMemo(
    () =>
      makeVaultApi(
        apiBaseUrl,
        () => getTokenRef.current(),
        getIdTokenRef.current ? () => getIdTokenRef.current!() : undefined,
        fetchImpl,
      ),
    [apiBaseUrl, fetchImpl],
  );

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [count, setCount] = useState(0);
  const [note, setNote] = useState<Note | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [status, setStatus] = useState<VaultStatus>({ kind: "idle" });
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [history, setHistory] = useState<NoteVersion[] | null>(null);

  const keys = useMemo(() => flattenKeys(tree), [tree]);
  const fail = (e: unknown) => setStatus({ kind: "error", message: (e as Error).message });

  const refreshTree = useCallback(async () => {
    try {
      const t = await api.tree();
      setTree(t.tree);
      setCount(t.count);
    } catch (e) {
      fail(e);
    }
  }, [api]);

  // Load the tree only once authenticated. useVault runs at the App top level (before
  // login), so an unconditional load would call getToken() with no token and fail with
  // "not authenticated"; gating on `enabled` defers it and retries the moment the user
  // signs in (enabled flips false -> true).
  useEffect(() => {
    if (enabled) void refreshTree();
  }, [enabled, refreshTree]);

  const loadBacklinks = useCallback(
    (key: string) => {
      api
        .backlinks(key)
        .then((b) => setBacklinks(b.backlinks))
        .catch(() => setBacklinks([]));
    },
    [api],
  );

  const open = useCallback(
    async (key: string) => {
      setStatus({ kind: "loading" });
      try {
        const n = await api.get(key);
        setNote(n);
        setDraft(n.content);
        setEditing(false);
        setResults(null);
        setHistory(null);
        setStatus({ kind: "idle" });
        loadBacklinks(key);
      } catch (e) {
        fail(e);
      }
    },
    [api, loadBacklinks],
  );

  const openWikilink = useCallback(
    (target: string) => {
      const key = resolveWikilink(target, keys);
      if (key) void open(key);
      else setStatus({ kind: "error", message: `No note matches [[${target}]]` });
    },
    [keys, open],
  );

  const save = useCallback(async () => {
    if (!note) return;
    setStatus({ kind: "saving" });
    try {
      const r = await api.put(note.key, draft);
      setNote({ ...note, content: draft, title: r.title });
      setEditing(false);
      setStatus({ kind: "idle" });
      loadBacklinks(note.key);
    } catch (e) {
      fail(e);
    }
  }, [api, note, draft, loadBacklinks]);

  const create = useCallback(
    async (key: string, content?: string) => {
      setStatus({ kind: "saving" });
      try {
        const title = key.split("/").pop()!.replace(/\.(md|markdown)$/i, "");
        // A blank note opens in edit mode to write; a note created WITH content (e.g. one
        // the chat agent drafted) opens in read mode so the user reviews the saved result.
        const seeded = content !== undefined;
        await api.put(key, seeded ? content : `# ${title}\n\n`);
        await refreshTree();
        await open(key);
        setEditing(!seeded);
      } catch (e) {
        fail(e);
      }
    },
    [api, refreshTree, open],
  );

  const remove = useCallback(
    async (key: string) => {
      try {
        await api.remove(key);
        if (note?.key === key) {
          setNote(null);
          setDraft("");
          setBacklinks([]);
        }
        await refreshTree();
      } catch (e) {
        fail(e);
      }
    },
    [api, note, refreshTree],
  );

  const removeDir = useCallback(
    async (prefix: string) => {
      try {
        await api.removeDir(prefix);
        // Close the open note if it lived in the folder we just deleted.
        const p = prefix.replace(/\/+$/, "");
        if (note && (note.key === p || note.key.startsWith(p + "/"))) {
          setNote(null);
          setDraft("");
          setBacklinks([]);
        }
        await refreshTree();
      } catch (e) {
        fail(e);
      }
    },
    [api, note, refreshTree],
  );

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults(null);
        return;
      }
      try {
        const r = await api.search(q);
        setResults(r.results);
      } catch (e) {
        fail(e);
      }
    },
    [api],
  );

  const loadHistory = useCallback(async () => {
    if (!note) return;
    try {
      const h = await api.history(note.key);
      setHistory(h.versions);
    } catch (e) {
      fail(e);
    }
  }, [api, note]);

  const restore = useCallback(
    async (versionId: string) => {
      if (!note) return;
      const key = note.key;
      setStatus({ kind: "saving" });
      try {
        await api.restore(key, versionId);
        setHistory(null);
        await open(key);
      } catch (e) {
        fail(e);
      }
    },
    [api, note, open],
  );

  const dirty = editing && note != null && draft !== note.content;

  return {
    tree,
    count,
    keys,
    note,
    draft,
    editing,
    dirty,
    backlinks,
    status,
    results,
    history,
    setDraft,
    setEditing,
    open,
    openWikilink,
    save,
    create,
    remove,
    removeDir,
    search,
    clearSearch: () => setResults(null),
    loadHistory,
    restore,
    clearHistory: () => setHistory(null),
    refreshTree,
  };
}
