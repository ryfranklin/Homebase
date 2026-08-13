// Vault operations over the Markdown corpus in S3. Pure logic with an injected
// `store` (list/get/put/delete on the corpus bucket) and a `reingest` callback
// (Bedrock Knowledge Base sync), so it is unit-testable without AWS. The real
// store and reingest are wired in handler.mjs.
//
// The corpus bucket IS the vault: notes are Markdown objects. Editing a note
// writes it back and best-effort re-grounds it for the agent. Single-tenant seed:
// the whole bucket is the tenant's vault (multi-tenant would prefix keys by
// tenant; the operations already flow a tenant through, so that is not precluded).

export function httpError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  return err;
}

// A note key must be a Markdown object inside the bucket, never a traversal, the
// bucket root, or one of the ingestion sidecar files.
export function assertSafeKey(key) {
  if (typeof key !== "string" || !key.trim()) throw httpError(400, "invalid_key", "key is required");
  if (key.startsWith("/") || key.includes("..") || key.includes("\\") || key.includes("\0")) {
    throw httpError(400, "invalid_key", "key must be a relative path with no traversal");
  }
  if (key.length > 1024) throw httpError(400, "invalid_key", "key too long");
  if (/\.metadata\.json$/i.test(key)) throw httpError(400, "invalid_key", "metadata sidecars are not editable");
  if (!/\.(md|markdown)$/i.test(key)) throw httpError(400, "invalid_key", "only .md/.markdown notes are supported");
  return key;
}

// Split leading YAML-ish front matter. Intentionally light (key: value lines) so
// the BFF needs no YAML dependency; it only feeds titles/tags, not full parsing.
export function splitFrontMatter(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content || "");
  if (!m) return { frontMatter: {}, body: content || "" };
  const frontMatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (mm) frontMatter[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, "");
  }
  return { frontMatter, body: content.slice(m[0].length) };
}

export function baseName(key) {
  return key.split("/").pop().replace(/\.(md|markdown)$/i, "");
}

export function noteTitle(key, content) {
  const { frontMatter, body } = splitFrontMatter(content || "");
  if (frontMatter.title) return frontMatter.title;
  const h1 = /^#\s+(.+)$/m.exec(body);
  if (h1) return h1[1].trim();
  return baseName(key);
}

// Obsidian-style wikilinks: [[target]], [[target|alias]], [[target#heading]].
const WIKILINK = /\[\[([^\]]+)\]\]/g;
export function extractWikilinks(content) {
  const out = [];
  let m;
  while ((m = WIKILINK.exec(content || ""))) {
    const target = m[1].split("|")[0].split("#")[0].trim();
    if (target) out.push(target);
  }
  return out;
}

// Resolve a wikilink target to an actual key: prefer an exact path match, else a
// unique basename match (how Obsidian resolves bare note names). Case-insensitive.
export function resolveLink(target, keys) {
  const t = String(target).replace(/\.(md|markdown)$/i, "").toLowerCase();
  const base = t.split("/").pop();
  let baseMatch = null;
  for (const k of keys) {
    const kNoExt = k.replace(/\.(md|markdown)$/i, "").toLowerCase();
    if (kNoExt === t) return k;
    if (!baseMatch && kNoExt.split("/").pop() === base) baseMatch = k;
  }
  return baseMatch;
}

// Flat keys -> nested tree of { name, path, type, children }.
export function buildTree(keys) {
  const root = { name: "", path: "", type: "dir", children: new Map() };
  for (const key of [...keys].sort()) {
    const parts = key.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      if (isFile) {
        node.children.set(part, { name: part, path: key, type: "file", title: baseName(key) });
      } else {
        const path = parts.slice(0, i + 1).join("/");
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, path, type: "dir", children: new Map() });
        }
        node = node.children.get(part);
      }
    });
  }
  const materialize = (node) => {
    const children = [...node.children.values()].map((c) => (c.type === "dir" ? materialize(c) : c));
    children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    return { name: node.name, path: node.path, type: "dir", children };
  };
  return materialize(root).children;
}

export function makeSnippet(body, query, radius = 90) {
  const idx = body.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return body.slice(0, radius * 2).replace(/\s+/g, " ").trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + query.length + radius);
  return (start > 0 ? "…" : "") + body.slice(start, end).replace(/\s+/g, " ").trim() + (end < body.length ? "…" : "");
}

// Bounded-concurrency map, so loading a few hundred small objects doesn't fan out
// unboundedly.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// store: { listKeys() -> string[], getObject(key) -> { content },
//          putObject(key, body, contentType, metadata), deleteObject(key) }
// reingest: () -> Promise (best-effort KB sync; may no-op)
export function makeVault({ store, reingest = async () => {}, now = () => Date.now(), cacheTtlMs = 30000 }) {
  // Warm-container cache of note contents for search/backlinks (content scans).
  let cache = null; // { at, notes: Map<key, {content, title}> }

  async function loadCorpus() {
    if (cache && now() - cache.at < cacheTtlMs) return cache.notes;
    const keys = await store.listKeys();
    const entries = await mapPool(keys, 16, async (key) => {
      try {
        const { content } = await store.getObject(key);
        return [key, { content: content || "", title: noteTitle(key, content) }];
      } catch {
        return null;
      }
    });
    const notes = new Map(entries.filter(Boolean));
    cache = { at: now(), notes };
    return notes;
  }

  function invalidate() {
    cache = null;
  }

  function metadataFor(content, actor, at) {
    // A small, budget-safe subset of front matter as object metadata, so KB
    // metadata filtering keeps working without the ingestion CLI's sidecar spill.
    // Also stamp attribution (who/when) on the object: S3 user metadata is
    // per-version, so this gives per-note AND per-history-entry authorship.
    const { frontMatter } = splitFrontMatter(content);
    const meta = {};
    if (frontMatter.title) meta.title = frontMatter.title.slice(0, 250);
    if (frontMatter.tags) meta.tags = frontMatter.tags.slice(0, 250);
    if (actor?.name) meta["updated-by"] = String(actor.name).slice(0, 250);
    if (actor?.id) meta["updated-by-id"] = String(actor.id).slice(0, 250);
    meta["updated-at"] = at || new Date(now()).toISOString();
    return meta;
  }

  function attributionFrom(metadata = {}) {
    return {
      updatedBy: metadata["updated-by"] || null,
      updatedById: metadata["updated-by-id"] || null,
      updatedAt: metadata["updated-at"] || null,
    };
  }

  return {
    async tree() {
      const keys = await store.listKeys();
      return { tree: buildTree(keys), count: keys.length };
    },

    async get(key) {
      assertSafeKey(key);
      const { content, metadata } = await store.getObject(key);
      const { frontMatter } = splitFrontMatter(content || "");
      return {
        key,
        content: content || "",
        title: noteTitle(key, content || ""),
        frontMatter,
        links: extractWikilinks(content || ""),
        ...attributionFrom(metadata),
      };
    },

    async put(key, content, actor) {
      assertSafeKey(key);
      if (typeof content !== "string") throw httpError(400, "invalid_content", "content must be a string");
      if (content.length > 5 * 1024 * 1024) throw httpError(413, "too_large", "note exceeds 5 MB");
      const at = new Date(now()).toISOString();
      await store.putObject(key, content, "text/markdown", metadataFor(content, actor, at));
      invalidate();
      await reingest().catch(() => {});
      return { ok: true, key, title: noteTitle(key, content), updatedBy: actor?.name || null, updatedAt: at };
    },

    async del(key, actor) {
      assertSafeKey(key);
      await store.deleteObject(key);
      invalidate();
      await reingest().catch(() => {});
      return { ok: true, key, deletedBy: actor?.name || null };
    },

    // Version history via S3 object versioning: each save is a restorable point,
    // and each version carries its own author metadata.
    async history(key, limit = 50) {
      assertSafeKey(key);
      const versions = await store.listVersions(key, limit);
      return {
        key,
        versions: versions.map((v) => ({
          versionId: v.versionId,
          updatedAt: v.updatedAt || v.lastModified || null,
          updatedBy: v.updatedBy || null,
          size: v.size ?? null,
          isCurrent: !!v.isCurrent,
        })),
      };
    },

    // Restore a prior version by copying it forward to a new current version,
    // attributed to whoever performed the restore.
    async restore(key, versionId, actor) {
      assertSafeKey(key);
      if (!versionId) throw httpError(400, "invalid_version", "versionId is required");
      const at = new Date(now()).toISOString();
      const { content } = await store.getObject(key, versionId);
      await store.putObject(key, content ?? "", "text/markdown", metadataFor(content ?? "", actor, at));
      invalidate();
      await reingest().catch(() => {});
      return { ok: true, key, restoredFrom: versionId, updatedBy: actor?.name || null, updatedAt: at };
    },

    async search(query, limit = 30) {
      const q = String(query || "").trim();
      if (!q) return { results: [] };
      const notes = await loadCorpus();
      const results = [];
      for (const [key, { content, title }] of notes) {
        const inTitle = title.toLowerCase().includes(q.toLowerCase());
        const inBody = content.toLowerCase().includes(q.toLowerCase());
        if (!inTitle && !inBody) continue;
        results.push({
          key,
          title,
          snippet: makeSnippet(content, q),
          score: (inTitle ? 2 : 0) + (inBody ? 1 : 0),
        });
      }
      results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
      return { results: results.slice(0, limit) };
    },

    async backlinks(key) {
      assertSafeKey(key);
      const notes = await loadCorpus();
      const keys = [...notes.keys()];
      const out = [];
      for (const [k, { content, title }] of notes) {
        if (k === key) continue;
        const targets = extractWikilinks(content);
        if (targets.some((t) => resolveLink(t, keys) === key)) {
          out.push({ key: k, title });
        }
      }
      out.sort((a, b) => a.title.localeCompare(b.title));
      return { backlinks: out };
    },
  };
}
