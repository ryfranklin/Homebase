import test from "node:test";
import assert from "node:assert/strict";

import { makeChatThreads, parseThread, serializeThread, threadKey } from "../src/chatthreads.mjs";

function fakeVault(seed = {}) {
  const notes = new Map(Object.entries(seed));
  return {
    notes,
    async tree() {
      const tree = [...notes.keys()].map((path) => ({ path, type: "file", name: path.split("/").pop() }));
      return { tree, count: tree.length };
    },
    async get(key) {
      if (!notes.has(key)) {
        const e = new Error("not found");
        e.status = 404;
        e.code = "not_found";
        throw e;
      }
      return { key, content: notes.get(key), title: key, updatedAt: "" };
    },
    async put(key, content) {
      notes.set(key, content);
      return { ok: true, key, title: "t" };
    },
    async del(key) {
      notes.delete(key);
      return { ok: true, key };
    },
  };
}

const MESSAGES = [
  { role: "user", text: "what did we decide about S3 Vectors?" },
  { role: "assistant", text: "ADR-002 kept S3 Vectors.\n\n## Notes\n\nrerank on." },
];

test("serialize/parse round-trips messages, tolerating '##' in content", () => {
  const md = serializeThread({
    title: "S3 Vectors",
    scope: "vault",
    created: "2026-08-18T00:00:00.000Z",
    updated: "2026-08-18T00:00:00.000Z",
    tenantId: "homebase",
    userId: "u1",
    messages: MESSAGES,
  });
  const { meta, messages } = parseThread(md);
  assert.equal(meta.type, "chat");
  assert.equal(meta.scope, "vault");
  assert.deepEqual(messages, MESSAGES);
});

test("save writes chat/<id>.md and preserves created on re-save", async () => {
  const vault = fakeVault();
  let clock = Date.parse("2026-08-18T10:00:00.000Z");
  const ct = makeChatThreads({ vault, now: () => clock });

  await ct.save("web-abc", { scope: "vault", messages: MESSAGES }, { tenantId: "homebase", userId: "u1" });
  assert.ok(vault.notes.has("chat/web-abc.md"));
  const first = parseThread(vault.notes.get("chat/web-abc.md")).meta;
  assert.equal(first.created, "2026-08-18T10:00:00.000Z");

  clock = Date.parse("2026-08-19T10:00:00.000Z");
  await ct.save("web-abc", { scope: "vault", messages: MESSAGES }, { tenantId: "homebase", userId: "u1" });
  const second = parseThread(vault.notes.get("chat/web-abc.md")).meta;
  assert.equal(second.created, "2026-08-18T10:00:00.000Z"); // unchanged
  assert.equal(second.updated, "2026-08-19T10:00:00.000Z"); // bumped
});

test("save derives a title from the first user message", async () => {
  const vault = fakeVault();
  const ct = makeChatThreads({ vault, now: () => Date.parse("2026-08-18T10:00:00.000Z") });
  const res = await ct.save("web-x", { scope: "general", messages: MESSAGES }, {});
  assert.match(res.title, /S3 Vectors/);
});

test("list returns newest-first and prunes threads past retention", async () => {
  const old = serializeThread({
    title: "old",
    scope: "vault",
    created: "2026-06-01T00:00:00.000Z",
    updated: "2026-06-01T00:00:00.000Z",
    tenantId: "homebase",
    userId: "u1",
    messages: MESSAGES,
  });
  const recent = serializeThread({
    title: "recent",
    scope: "vault",
    created: "2026-08-17T00:00:00.000Z",
    updated: "2026-08-17T00:00:00.000Z",
    tenantId: "homebase",
    userId: "u1",
    messages: MESSAGES,
  });
  const vault = fakeVault({ "chat/old.md": old, "chat/recent.md": recent, "wiki/not-a-thread.md": "# no" });
  const ct = makeChatThreads({ vault, retentionDays: 30, now: () => Date.parse("2026-08-18T00:00:00.000Z") });

  const { threads } = await ct.list({ tenantId: "homebase", userId: "u1" });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, "recent");
  // The old thread was pruned from the vault (and thus the KB).
  assert.ok(!vault.notes.has("chat/old.md"));
  // Non-chat notes are untouched.
  assert.ok(vault.notes.has("wiki/not-a-thread.md"));
});

test("threadKey rejects unsafe ids", () => {
  assert.equal(threadKey("web-abc"), "chat/web-abc.md");
  assert.throws(() => threadKey("../etc/passwd"));
  assert.throws(() => threadKey("a/b"));
});
