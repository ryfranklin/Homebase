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
  const map = new Map(Object.entries(seed));
  return {
    map,
    puts: [],
    deletes: [],
    async listKeys() {
      return [...map.keys()];
    },
    async getObject(key) {
      if (!map.has(key)) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      return { content: map.get(key) };
    },
    async putObject(key, body) {
      map.set(key, body);
      this.puts.push(key);
    },
    async deleteObject(key) {
      map.delete(key);
      this.deletes.push(key);
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

test("put writes the note and triggers reingest", async () => {
  const store = fakeStore();
  let reingested = 0;
  const vault = makeVault({ store, reingest: async () => { reingested++; } });
  const res = await vault.put("new/note.md", "# New\n[[x]]");
  assert.deepEqual(res, { ok: true, key: "new/note.md", title: "New" });
  assert.equal(store.map.get("new/note.md"), "# New\n[[x]]");
  assert.equal(reingested, 1);
});

test("put rejects unsafe keys before writing", async () => {
  const store = fakeStore();
  const vault = makeVault({ store });
  await assert.rejects(() => vault.put("../evil.md", "x"), { code: "invalid_key" });
  assert.equal(store.puts.length, 0);
});

test("del removes the note and triggers reingest", async () => {
  const store = fakeStore({ "gone.md": "bye" });
  let reingested = 0;
  const vault = makeVault({ store, reingest: async () => { reingested++; } });
  await vault.del("gone.md");
  assert.equal(store.map.has("gone.md"), false);
  assert.equal(reingested, 1);
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
  const vault = makeVault({ store });
  assert.equal((await vault.search("beta")).results.length, 0);
  await vault.put("b.md", "beta content");
  assert.equal((await vault.search("beta")).results.length, 1);
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

test("PUT /api/vault/note writes via the body", async () => {
  const store = fakeStore();
  const vault = makeVault({ store });
  const { rec } = await route({ method: "PUT", path: "/api/vault/note", body: { key: "n.md", content: "# hi" }, vault });
  assert.equal(rec.statusCode, 200);
  assert.equal(store.map.get("n.md"), "# hi");
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
