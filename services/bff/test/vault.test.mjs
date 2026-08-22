import test from "node:test";
import assert from "node:assert/strict";

import {
  makeVault,
  buildTree,
  extractWikilinks,
  resolveLink,
  splitFrontMatter,
  noteTitle,
  assertSafeKey,
  normalizeDirPrefix,
  keysUnderPrefix,
  templateLabel,
  parseListValue,
} from "../src/vault.mjs";
import { handleRequest } from "../src/bff.mjs";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("splitFrontMatter separates YAML-ish front matter from the body", () => {
  const { frontMatter, body } = splitFrontMatter("---\ntitle: Hello\ntags: a, b\n---\n# Body\ntext");
  assert.equal(frontMatter.title, "Hello");
  assert.equal(frontMatter.tags, "a, b");
  assert.equal(body, "# Body\ntext");
});

test("noteTitle prefers front matter, then H1, then basename", () => {
  assert.equal(noteTitle("d/x.md", "---\ntitle: FM\n---\n# H1\n"), "FM");
  assert.equal(noteTitle("d/x.md", "# H1 heading\nbody"), "H1 heading");
  assert.equal(noteTitle("d/my-note.md", "no title here"), "my-note");
});

test("extractWikilinks handles aliases and headings", () => {
  assert.deepEqual(extractWikilinks("see [[adr-002]] and [[folder/note|Alias]] and [[x#h]]"), [
    "adr-002",
    "folder/note",
    "x",
  ]);
});

test("resolveLink matches by exact path, then unique basename", () => {
  const keys = ["data-eng/adr-002.md", "notes/x.md"];
  assert.equal(resolveLink("adr-002", keys), "data-eng/adr-002.md");
  assert.equal(resolveLink("data-eng/adr-002", keys), "data-eng/adr-002.md");
  assert.equal(resolveLink("missing", keys), null);
});

test("buildTree nests folders (dirs first, sorted)", () => {
  const tree = buildTree(["b/z.md", "a/y.md", "top.md", "a/sub/deep.md"]);
  assert.deepEqual(
    tree.map((n) => `${n.type}:${n.name}`),
    ["dir:a", "dir:b", "file:top.md"],
  );
  const a = tree.find((n) => n.name === "a");
  assert.deepEqual(a.children.map((n) => `${n.type}:${n.name}`), ["dir:sub", "file:y.md"]);
});

test("templateLabel drops the template suffix and word separators", () => {
  assert.equal(templateLabel("templates/adr-template.md"), "adr");
  assert.equal(templateLabel("templates/project design template.md"), "project design");
  assert.equal(templateLabel("templates/wiki-entity-template.md"), "wiki entity");
});

test("parseListValue parses bracketed and comma lists", () => {
  assert.deepEqual(parseListValue("[adr]"), ["adr"]);
  assert.deepEqual(parseListValue("adr, ai"), ["adr", "ai"]);
  assert.deepEqual(parseListValue("[]"), []);
  assert.deepEqual(parseListValue(""), []);
});

test("assertSafeKey rejects traversal, non-markdown, and sidecars", () => {
  assert.throws(() => assertSafeKey("../etc/passwd"), { code: "invalid_key" });
  assert.throws(() => assertSafeKey("/abs.md"), { code: "invalid_key" });
  assert.throws(() => assertSafeKey("notes/x.txt"), { code: "invalid_key" });
  assert.throws(() => assertSafeKey("notes/x.md.metadata.json"), { code: "invalid_key" });
  assert.equal(assertSafeKey("notes/x.md"), "notes/x.md");
});

// ---------------------------------------------------------------------------
// makeVault with an in-memory fake store
// ---------------------------------------------------------------------------

function fakeStore(seed = {}) {
  const map = new Map(); // key -> latest content (convenience view)
  const versions = new Map(); // key -> [{versionId, content, metadata, ...}] newest-first
  let vseq = 0;
  const write = (key, content, metadata = {}) => {
    vseq += 1;
    map.set(key, content);
    const list = versions.get(key) || [];
    list.unshift({ versionId: `v${vseq}`, content, metadata, lastModified: `2026-01-01T00:00:0${vseq % 10}Z`, size: content.length });
    versions.set(key, list);
  };
  for (const [k, v] of Object.entries(seed)) write(k, v);
  return {
    map,
    versions,
    puts: [],
    deletes: [],
    async listKeys() {
      return [...map.keys()];
    },
    async getObject(key, versionId) {
      if (versionId) {
        const v = (versions.get(key) || []).find((x) => x.versionId === versionId);
        if (!v) throw Object.assign(new Error("NoSuchVersion"), { name: "NoSuchVersion" });
        return { content: v.content, metadata: v.metadata };
      }
      if (!map.has(key)) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      const latest = (versions.get(key) || [])[0] || { metadata: {} };
      return { content: map.get(key), metadata: latest.metadata };
    },
    async putObject(key, body, _ct, metadata) {
      write(key, body, metadata || {});
      this.puts.push(key);
    },
    async deleteObject(key) {
      map.delete(key);
      this.deletes.push(key);
    },
    async listVersions(key, limit = 50) {
      return (versions.get(key) || []).slice(0, limit).map((v, i) => ({
        versionId: v.versionId,
        lastModified: v.lastModified,
        updatedAt: v.metadata["updated-at"] || null,
        updatedBy: v.metadata["updated-by"] || null,
        size: v.size,
        isCurrent: i === 0,
      }));
    },
  };
}

// Fake vault worker: mirrors content to the store (so read-after-write holds) AND
// keeps a per-file git-log, so attribution/history/restore read from git the way
// the real worker serves them. Authorship is the commit author (name + email).
function fakeWriter(store) {
  const writes = [];
  const logs = new Map(); // key -> [{ commit, authorName, authorEmail, date, content }] newest-first
  let seq = 0;
  const commit = (key, content, actor) => {
    seq += 1;
    const name = actor?.name || "Homebase";
    const email = actor?.email || (name.includes("@") ? name : `${actor?.id || "homebase"}@homebase.local`);
    const list = logs.get(key) || [];
    list.unshift({ commit: `c${String(seq).padStart(39, "0")}`, authorName: name, authorEmail: email, date: `2026-01-01T00:00:0${seq % 10}Z`, content });
    logs.set(key, list);
  };
  return {
    writes,
    logs,
    async write(key, content, actor) {
      await store.putObject(key, content, "text/markdown", {});
      commit(key, content, actor);
      writes.push({ op: "write", key, content, actor });
      return { ok: true, changed: true };
    },
    async remove(key, actor) {
      await store.deleteObject(key);
      writes.push({ op: "remove", key, actor });
      return { ok: true, changed: true };
    },
    async log(key, limit = 50) {
      return (logs.get(key) || []).slice(0, limit).map((e, i) => ({
        commit: e.commit,
        authorName: e.authorName,
        authorEmail: e.authorEmail,
        date: e.date,
        subject: `update ${key}`,
        isCurrent: i === 0,
      }));
    },
    async readAt(key, ref) {
      const e = (logs.get(key) || []).find((x) => x.commit === ref);
      if (!e) throw Object.assign(new Error("version_not_found"), { status: 404, code: "version_not_found" });
      return e.content;
    },
  };
}

test("tree lists markdown keys as a nested tree", async () => {
  const vault = makeVault({ store: fakeStore({ "a/one.md": "# One", "two.md": "# Two" }) });
  const { tree, count } = await vault.tree();
  assert.equal(count, 2);
  assert.equal(tree[0].name, "a");
  assert.equal(tree[0].children[0].path, "a/one.md");
});

test("get returns content, title, and wikilinks", async () => {
  const vault = makeVault({ store: fakeStore({ "n.md": "---\ntitle: N\n---\nlinks [[a]] [[b]]" }) });
  const note = await vault.get("n.md");
  assert.equal(note.title, "N");
  assert.deepEqual(note.links, ["a", "b"]);
});

test("templates lists only the templates/ skeletons, excluding CLAUDE.md", async () => {
  const vault = makeVault({
    store: fakeStore({
      "templates/adr-template.md": "---\ntitle: \"ADR-000: {{title}}\"\ntags: [adr]\n---\n# ADR",
      "templates/wiki-entity-template.md": "---\ntitle: \"{{title}}\"\ntype: entity\ntags: []\n---\n# x",
      "templates/CLAUDE.md": "# subtree guidance, not a template",
      "work/real-note.md": "# not a template",
    }),
  });
  const { templates, count } = await vault.templates();
  assert.equal(count, 2);
  assert.deepEqual(templates.map((t) => t.path).sort(), ["templates/adr-template.md", "templates/wiki-entity-template.md"]);
  const adr = templates.find((t) => t.name === "adr-template");
  assert.equal(adr.label, "adr");
  assert.deepEqual(adr.tags, ["adr"]);
  // A placeholder front-matter title falls back to the clean label, not "{{title}}".
  const entity = templates.find((t) => t.name === "wiki-entity-template");
  assert.equal(entity.title, "wiki entity");
  assert.equal(entity.type, "entity");
});

test("put commits through the worker", async () => {
  const store = fakeStore();
  const writer = fakeWriter(store);
  const vault = makeVault({ store, writer });
  const res = await vault.put("new/note.md", "# New\n[[x]]", { id: "u1", name: "ryan" });
  assert.equal(res.ok, true);
  assert.equal(res.key, "new/note.md");
  assert.equal(res.title, "New");
  assert.equal(store.map.get("new/note.md"), "# New\n[[x]]"); // worker mirrored it
  assert.equal(writer.writes[0].op, "write");
});

test("put 503s when no worker is configured", async () => {
  const vault = makeVault({ store: fakeStore() });
  await assert.rejects(() => vault.put("n.md", "x"), { code: "writes_unavailable" });
});

test("put rejects unsafe keys before writing", async () => {
  const store = fakeStore();
  const vault = makeVault({ store, writer: fakeWriter(store) });
  await assert.rejects(() => vault.put("../evil.md", "x"), { code: "invalid_key" });
  assert.equal(store.puts.length, 0);
});

test("del removes the note through the worker", async () => {
  const store = fakeStore({ "gone.md": "bye" });
  const writer = fakeWriter(store);
  const vault = makeVault({ store, writer });
  await vault.del("gone.md");
  assert.equal(store.map.has("gone.md"), false);
  assert.equal(writer.writes[0].op, "remove");
});

// ---------------------------------------------------------------------------
// Directory delete
// ---------------------------------------------------------------------------

test("normalizeDirPrefix strips trailing slash and rejects root/traversal", () => {
  assert.equal(normalizeDirPrefix("work/aws/"), "work/aws");
  assert.equal(normalizeDirPrefix("work"), "work");
  assert.throws(() => normalizeDirPrefix(""), { code: "invalid_prefix" });
  assert.throws(() => normalizeDirPrefix("/"), { code: "invalid_prefix" });
  assert.throws(() => normalizeDirPrefix("../etc"), { code: "invalid_prefix" });
  assert.throws(() => normalizeDirPrefix("/abs"), { code: "invalid_prefix" });
});

test("keysUnderPrefix matches children on the path boundary only", () => {
  const keys = ["work/a.md", "work/sub/b.md", "workshop/c.md", "top.md"];
  assert.deepEqual(keysUnderPrefix(keys, "work"), ["work/a.md", "work/sub/b.md"]);
  assert.deepEqual(keysUnderPrefix(keys, "work/"), ["work/a.md", "work/sub/b.md"]); // trailing slash ok
  assert.deepEqual(keysUnderPrefix(keys, "workshop"), ["workshop/c.md"]); // not matched by "work"
});

test("delDir removes every note under a folder through the worker", async () => {
  const store = fakeStore({ "work/a.md": "a", "work/sub/b.md": "b", "workshop/c.md": "c", "top.md": "t" });
  const writer = fakeWriter(store);
  const vault = makeVault({ store, writer });
  const res = await vault.delDir("work", { id: "u1", name: "ryan" });
  assert.equal(res.ok, true);
  assert.equal(res.deletedCount, 2);
  assert.deepEqual(res.deleted.sort(), ["work/a.md", "work/sub/b.md"]);
  assert.equal(store.map.has("work/a.md"), false);
  assert.equal(store.map.has("work/sub/b.md"), false);
  assert.equal(store.map.has("workshop/c.md"), true); // sibling folder untouched
  assert.equal(store.map.has("top.md"), true);
  assert.ok(writer.writes.every((w) => w.op === "remove"));
});

test("delDir 404s when the folder has no notes", async () => {
  const store = fakeStore({ "other/x.md": "x" });
  const vault = makeVault({ store, writer: fakeWriter(store) });
  await assert.rejects(() => vault.delDir("missing", { name: "ryan" }), { code: "not_found" });
});

test("delDir 503s without a worker and rejects the vault root", async () => {
  const noWriter = makeVault({ store: fakeStore({ "work/a.md": "a" }) });
  await assert.rejects(() => noWriter.delDir("work", { name: "ryan" }), { code: "writes_unavailable" });
  const store = fakeStore({ "work/a.md": "a" });
  const vault = makeVault({ store, writer: fakeWriter(store) });
  await assert.rejects(() => vault.delDir("", { name: "ryan" }), { code: "invalid_prefix" });
  assert.equal(store.map.has("work/a.md"), true); // nothing deleted on a bad prefix
});

test("search matches title and body, ranking title hits higher", async () => {
  const vault = makeVault({
    store: fakeStore({ "rerank.md": "# Rerank\ncohere model", "other.md": "mentions rerank once" }),
  });
  const { results } = await vault.search("rerank");
  assert.equal(results.length, 2);
  assert.equal(results[0].key, "rerank.md"); // title hit ranks first
  assert.ok(results[0].snippet.length > 0);
});

test("backlinks finds notes whose wikilinks resolve to the target", async () => {
  const vault = makeVault({
    store: fakeStore({
      "data/adr-002.md": "# ADR 002",
      "a.md": "see [[adr-002]]",
      "b.md": "see [[data/adr-002]]",
      "c.md": "unrelated",
    }),
  });
  const { backlinks } = await vault.backlinks("data/adr-002.md");
  assert.deepEqual(backlinks.map((b) => b.key).sort(), ["a.md", "b.md"]);
});

test("corpus cache is invalidated on write so search sees new notes", async () => {
  const store = fakeStore({ "a.md": "alpha" });
  const vault = makeVault({ store, writer: fakeWriter(store) });
  assert.equal((await vault.search("beta")).results.length, 0);
  await vault.put("b.md", "beta content");
  assert.equal((await vault.search("beta")).results.length, 1);
});

// ---------------------------------------------------------------------------
// Attribution + history / restore
// ---------------------------------------------------------------------------

const alice = { id: "u-alice", name: "alice@example.com" };
const bob = { id: "u-bob", name: "bob@example.com" };

test("put stamps the author, and get returns attribution", async () => {
  const store = fakeStore();
  const vault = makeVault({ store, writer: fakeWriter(store) });
  await vault.put("n.md", "# hi", alice);
  const note = await vault.get("n.md");
  assert.equal(note.updatedBy, "alice@example.com"); // git author name
  assert.equal(note.updatedById, "alice@example.com"); // git author email (no Cognito sub in git)
  assert.ok(note.updatedAt);
});

test("history lists versions newest-first with authors and a current flag", async () => {
  const store = fakeStore();
  const vault = makeVault({ store, writer: fakeWriter(store) });
  await vault.put("n.md", "v1", alice);
  await vault.put("n.md", "v2", bob);
  const { versions } = await vault.history("n.md");
  assert.equal(versions.length, 2);
  assert.equal(versions[0].updatedBy, "bob@example.com");
  assert.equal(versions[0].isCurrent, true);
  assert.equal(versions[1].updatedBy, "alice@example.com");
});

test("restore copies an old version forward, attributed to the restorer", async () => {
  const store = fakeStore();
  const writer = fakeWriter(store);
  const vault = makeVault({ store, writer });
  await vault.put("n.md", "original", alice);
  await vault.put("n.md", "changed", bob);
  const { versions } = await vault.history("n.md");
  const oldest = versions[versions.length - 1];
  const res = await vault.restore("n.md", oldest.versionId, alice);
  assert.equal(res.ok, true);
  assert.equal(res.restoredFrom, oldest.versionId);
  assert.equal(store.map.get("n.md"), "original"); // content reverted via the worker
  const note = await vault.get("n.md");
  assert.equal(note.updatedBy, "alice@example.com"); // attributed to who restored
});

test("restore requires a versionId", async () => {
  const store = fakeStore({ "n.md": "x" });
  const vault = makeVault({ store, writer: fakeWriter(store) });
  await assert.rejects(() => vault.restore("n.md", "", alice), { code: "invalid_version" });
});

// ---------------------------------------------------------------------------
// Route dispatch through handleRequest
// ---------------------------------------------------------------------------

const CFG = { issuer: "i", audience: "a", agentRuntimeArn: "arn", allowedOrigin: "https://app.example.invalid" };

function verifyToken() {
  return { sub: "user-1", "custom:tenant_id": "tenant-1" };
}

function makeRespond() {
  const calls = [];
  const respond = (statusCode, headers) => {
    const rec = { statusCode, headers, chunks: [], ended: false };
    calls.push(rec);
    return { write: (c) => rec.chunks.push(c), end: () => (rec.ended = true) };
  };
  respond.calls = calls;
  return respond;
}

async function route({ method = "GET", path, query, body, vault }) {
  const respond = makeRespond();
  await handleRequest(
    {
      headers: { authorization: "Bearer t" },
      rawPath: path,
      requestContext: { http: { method, path } },
      queryStringParameters: query,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    respond,
    { verifyToken, config: CFG, vault },
  );
  const rec = respond.calls[0];
  return { rec, json: () => JSON.parse(rec.chunks.join("")) };
}

test("GET /api/vault/tree dispatches to the vault", async () => {
  const vault = makeVault({ store: fakeStore({ "x.md": "# X" }) });
  const { rec, json } = await route({ path: "/api/vault/tree", vault });
  assert.equal(rec.statusCode, 200);
  assert.equal(json().count, 1);
});

test("GET /api/vault/templates dispatches to the vault (router allow-list includes it)", async () => {
  // Regression: the templates case existed in handleVault but was missing from the
  // router's resource allow-list regex, so authenticated /api/vault/templates fell
  // through to a non-JSON 200 ("vault API not available yet" in the client).
  const vault = makeVault({ store: fakeStore({ "templates/adr-template.md": "---\ntags: [adr]\n---\n# ADR" }) });
  const { rec, json } = await route({ path: "/api/vault/templates", vault });
  assert.equal(rec.statusCode, 200);
  assert.equal(json().templates[0].name, "adr-template");
});

test("PUT /api/vault/note writes via the body", async () => {
  const store = fakeStore();
  const vault = makeVault({ store, writer: fakeWriter(store) });
  const { rec } = await route({ method: "PUT", path: "/api/vault/note", body: { key: "n.md", content: "# hi" }, vault });
  assert.equal(rec.statusCode, 200);
  assert.equal(store.map.get("n.md"), "# hi");
});

test("DELETE /api/vault/dir removes the folder's notes via the route", async () => {
  const store = fakeStore({ "work/a.md": "a", "work/b.md": "b", "keep.md": "k" });
  const vault = makeVault({ store, writer: fakeWriter(store) });
  const { rec, json } = await route({ method: "DELETE", path: "/api/vault/dir", query: { prefix: "work" }, vault });
  assert.equal(rec.statusCode, 200);
  assert.equal(json().deletedCount, 2);
  assert.equal(store.map.has("work/a.md"), false);
  assert.equal(store.map.has("keep.md"), true); // sibling note kept
});

test("vault routes 503 when the vault is not configured", async () => {
  const { rec } = await route({ path: "/api/vault/tree", vault: undefined });
  assert.equal(rec.statusCode, 503);
});

test("unsafe key over the route surfaces a 400", async () => {
  const vault = makeVault({ store: fakeStore() });
  const { rec, json } = await route({ path: "/api/vault/note", query: { key: "../evil.md" }, vault });
  assert.equal(rec.statusCode, 400);
  assert.equal(json().error, "invalid_key");
});

test("route stamps the verified user as author and history reflects it", async () => {
  const store = fakeStore();
  const vault = makeVault({ store, writer: fakeWriter(store) });
  await route({ method: "PUT", path: "/api/vault/note", body: { key: "n.md", content: "# hi" }, vault });
  const read = await route({ path: "/api/vault/note", query: { key: "n.md" }, vault });
  assert.equal(read.json().updatedBy, "user-1"); // verifyToken() returns sub "user-1", no email
  const hist = await route({ path: "/api/vault/history", query: { key: "n.md" }, vault });
  assert.equal(hist.json().versions[0].updatedBy, "user-1");
});
