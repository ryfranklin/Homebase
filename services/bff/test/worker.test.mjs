import test from "node:test";
import assert from "node:assert/strict";

import { makeWorkerClient } from "../src/worker.mjs";

function fakeFetch(calls, response = { ok: true, status: 200, body: { ok: true, changed: true } }) {
  return async (url, init) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status,
      async json() {
        return response.body;
      },
      async text() {
        return JSON.stringify(response.body);
      },
    };
  };
}

test("write posts to /write with the secret and derived git author", async () => {
  const calls = [];
  const client = makeWorkerClient({ url: "http://worker:8080/", secret: "s3cr3t", fetchImpl: fakeFetch(calls) });
  const res = await client.write("notes/a.md", "# hi", { id: "u1", name: "ryan@x.com" });
  assert.deepEqual(res, { ok: true, changed: true });
  const { url, init } = calls[0];
  assert.equal(url, "http://worker:8080/write"); // trailing slash normalized
  assert.equal(init.headers["x-worker-secret"], "s3cr3t");
  const body = JSON.parse(init.body);
  assert.equal(body.path, "notes/a.md");
  // The verified email is used verbatim; the id rides along for S3 attribution.
  assert.deepEqual(body.author, { name: "ryan@x.com", email: "ryan@x.com", id: "u1" });
});

test("prefers the verified email claim over a synthetic address", async () => {
  const calls = [];
  const client = makeWorkerClient({ url: "http://worker:8080", secret: "s", fetchImpl: fakeFetch(calls) });
  // A display name plus a distinct verified email (from the ID token).
  await client.write("a.md", "x", { id: "u2", name: "Ryan Franklin", email: "ryan@x.com" });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.author, { name: "Ryan Franklin", email: "ryan@x.com", id: "u2" });
});

test("derives an email when the name is not one, and omits the header without a secret", async () => {
  const calls = [];
  const client = makeWorkerClient({ url: "http://worker:8080", secret: null, fetchImpl: fakeFetch(calls) });
  await client.write("a.md", "x", { id: "user-1", name: "user-1" });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.author, { name: "user-1", email: "user-1@homebase.local", id: "user-1" });
  assert.equal(calls[0].init.headers["x-worker-secret"], undefined);
});

test("log GETs /log with the path and returns the entries", async () => {
  const calls = [];
  const entries = [{ commit: "c1", authorName: "ryan", authorEmail: "ryan@x.com", date: "2026-01-01T00:00:00Z", isCurrent: true }];
  const client = makeWorkerClient({ url: "http://worker:8080", secret: "s", fetchImpl: fakeFetch(calls, { ok: true, status: 200, body: { path: "n.md", entries } }) });
  const out = await client.log("dir/n.md", 10);
  assert.equal(calls[0].url, "http://worker:8080/log?path=dir%2Fn.md&limit=10");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["x-worker-secret"], "s");
  assert.deepEqual(out, entries);
});

test("readAt GETs /file with the ref and returns the content", async () => {
  const calls = [];
  const client = makeWorkerClient({ url: "http://worker:8080", secret: "s", fetchImpl: fakeFetch(calls, { ok: true, status: 200, body: { path: "n.md", content: "old" } }) });
  const content = await client.readAt("n.md", "abc1234");
  assert.equal(calls[0].url, "http://worker:8080/file?path=n.md&ref=abc1234");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(content, "old");
});

test("remove posts to /delete", async () => {
  const calls = [];
  const client = makeWorkerClient({ url: "http://worker:8080", secret: "s", fetchImpl: fakeFetch(calls) });
  await client.remove("gone.md", { id: "u", name: "u" });
  assert.equal(calls[0].url, "http://worker:8080/delete");
  assert.equal(JSON.parse(calls[0].init.body).path, "gone.md");
});

test("throws a 502 worker_error on a failed response", async () => {
  const client = makeWorkerClient({
    url: "http://worker:8080",
    secret: "s",
    fetchImpl: fakeFetch([], { ok: false, status: 500, body: { error: "boom" } }),
  });
  await assert.rejects(
    () => client.write("a.md", "x", { id: "u", name: "u" }),
    (e) => e.status === 502 && e.code === "worker_error",
  );
});
