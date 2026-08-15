import test from "node:test";
import assert from "node:assert/strict";

import { toCql, mapConfluenceResults } from "../src/confluence.mjs";
import { handleRequest } from "../src/bff.mjs";

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
async function route({ path, query, confluence }) {
  const respond = makeRespond();
  await handleRequest(
    {
      headers: { authorization: "Bearer t" },
      rawPath: path,
      rawQueryString: query ?? "",
      queryStringParameters: query ? Object.fromEntries(new URLSearchParams(query)) : undefined,
      requestContext: { http: { method: "GET", path } },
    },
    respond,
    { verifyToken, config: CFG, confluence },
  );
  const rec = respond.calls[0];
  return { rec, json: () => JSON.parse(rec.chunks.join("")) };
}

test("toCql bounds free text and falls back to a page query", () => {
  assert.equal(toCql('relay "design"'), 'text ~ "relay design" order by lastmodified desc');
  assert.equal(toCql(""), "type = page order by lastmodified desc");
});

test("mapConfluenceResults maps Atlassian results tolerantly and strips excerpt html", () => {
  const body = {
    results: [
      { content: { id: "123", title: "Relay design", _links: { webui: "/spaces/X/pages/123" } }, excerpt: "a <b>relay</b> canvas" },
      { id: "9", title: "Loose result", url: "https://x/9" },
      { nothing: true },
    ],
  };
  const out = mapConfluenceResults(body, "https://acme.atlassian.net/");
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: "123", title: "Relay design", url: "https://acme.atlassian.net/wiki/spaces/X/pages/123", excerpt: "a relay canvas" });
  assert.equal(out[1].url, "https://x/9");
});

test("GET /api/plan/confluence/search returns the mapped pages", async () => {
  const seen = [];
  const confluence = {
    async search(tenantId, q) {
      seen.push([tenantId, q]);
      return { results: [{ id: "1", title: "Design", url: "u", excerpt: "e" }] };
    },
  };
  const { rec, json } = await route({ path: "/api/plan/confluence/search", query: "q=relay", confluence });
  assert.equal(rec.statusCode, 200);
  assert.equal(json().results[0].title, "Design");
  assert.deepEqual(seen, [["tenant-1", "relay"]]); // tenant from the token, query from ?q
});

test("confluence search degrades to empty when not configured", async () => {
  const { rec, json } = await route({ path: "/api/plan/confluence/search", query: "q=x", confluence: undefined });
  assert.equal(rec.statusCode, 200);
  assert.deepEqual(json(), { results: [] });
});
