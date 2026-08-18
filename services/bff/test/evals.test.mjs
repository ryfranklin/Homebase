import test from "node:test";
import assert from "node:assert/strict";

import { makeEvals } from "../src/evals.mjs";

function fakeClients({ items = [], object = null, s3Error = null } = {}) {
  return {
    dynamo: {
      async query(args) {
        assert.equal(args.ExpressionAttributeValues[":pk"].S, "TENANT#homebase");
        assert.equal(args.ScanIndexForward, false);
        return { Items: items };
      },
    },
    s3: {
      async getObject(args) {
        if (s3Error) throw s3Error;
        assert.match(args.Key, /^runs\/.+\/payload\.json$/);
        return { Body: { transformToString: async () => JSON.stringify(object) } };
      },
    },
  };
}

test("listRuns parses run headers, surfacing top model and created-at", async () => {
  const items = [
    {
      run_id: { S: "r1" },
      suite: { S: "gen-hard" },
      judge: { S: "us.anthropic.claude-sonnet-4-6" },
      status: { S: "complete" },
      sk: { S: "RUN#2026-08-18T03:38:00Z#r1" },
      scorecards: { S: JSON.stringify([{ model: "us.anthropic.claude-sonnet-4-6", avg_quality: 0.914 }, { model: "zai.glm-5", avg_quality: 0.893 }]) },
    },
  ];
  const evals = await makeEvals({ tableName: "t", bucketName: "b", clients: fakeClients({ items }) });
  const { runs } = await evals.listRuns("homebase", {});
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runId, "r1");
  assert.equal(runs[0].createdAt, "2026-08-18T03:38:00Z");
  assert.equal(runs[0].topModel, "us.anthropic.claude-sonnet-4-6");
  assert.equal(runs[0].topQuality, 0.914);
  assert.equal(runs[0].nModels, 2);
});

test("getRun returns the S3 payload verbatim", async () => {
  const payload = { meta: { suite: "gen-hard" }, scorecards: [], tags: [], cases: [] };
  const evals = await makeEvals({ tableName: "t", bucketName: "b", clients: fakeClients({ object: payload }) });
  const got = await evals.getRun("homebase", "r1");
  assert.deepEqual(got, payload);
});

test("getRun maps a missing object to a 404", async () => {
  const err = new Error("nope");
  err.name = "NoSuchKey";
  const evals = await makeEvals({ tableName: "t", bucketName: "b", clients: fakeClients({ s3Error: err }) });
  await assert.rejects(() => evals.getRun("homebase", "missing"), (e) => e.status === 404 && e.code === "run_not_found");
});
