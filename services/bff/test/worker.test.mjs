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
  assert.deepEqual(body.author, { name: "ryan@x.com", email: "ryan@x.com" });
});

test("derives an email when the name is not one, and omits the header without a secret", async () => {
  const calls = [];
  const client = makeWorkerClient({ url: "http://worker:8080", secret: null, fetchImpl: fakeFetch(calls) });
  await client.write("a.md", "x", { id: "user-1", name: "user-1" });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.author, { name: "user-1", email: "user-1@homebase.local" });
  assert.equal(calls[0].init.headers["x-worker-secret"], undefined);
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
