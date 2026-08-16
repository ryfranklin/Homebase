import { test } from "node:test";
import assert from "node:assert/strict";

import { makeSettings } from "../src/settings.mjs";

function fakeClients() {
  const calls = { put: [], update: [] };
  return {
    calls,
    putSecretValue: async (args) => {
      calls.put.push(args);
      return {};
    },
    updateService: async (args) => {
      calls.update.push(args);
      return {};
    },
  };
}

test("setGithubToken stores the token and force-restarts MC", async () => {
  const clients = fakeClients();
  const settings = makeSettings({
    region: "us-east-1",
    githubTokenSecretArn: "arn:aws:secretsmanager:us-east-1:1:secret:gh",
    cluster: "mc-cluster",
    service: "mc-service",
    clients,
  });

  const result = await settings.setGithubToken("  ghp_realtoken123  ");

  assert.deepEqual(result, { ok: true, restarted: true });
  // Stored under the right secret, trimmed.
  assert.deepEqual(clients.calls.put[0], {
    SecretId: "arn:aws:secretsmanager:us-east-1:1:secret:gh",
    SecretString: "ghp_realtoken123",
  });
  // Restarted the MC service.
  assert.deepEqual(clients.calls.update[0], {
    cluster: "mc-cluster",
    service: "mc-service",
    forceNewDeployment: true,
  });
});

test("setGithubToken rejects an empty token before touching AWS", async () => {
  const clients = fakeClients();
  const settings = makeSettings({ region: "us-east-1", githubTokenSecretArn: "arn", cluster: "c", service: "s", clients });

  for (const bad of ["", "   ", null, undefined, 123]) {
    await assert.rejects(() => settings.setGithubToken(bad), (e) => e.statusCode === 400 && e.code === "invalid_token");
  }
  assert.equal(clients.calls.put.length, 0);
  assert.equal(clients.calls.update.length, 0);
});
