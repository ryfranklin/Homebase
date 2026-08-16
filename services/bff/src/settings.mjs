// Operator settings seam: WRITE-ONLY management of a secret from the GUI.
//
// setGithubToken stores the GitHub token that Mission Control uses to clone/fetch
// target repos into Secrets Manager, then force-restarts the MC service so it picks
// the new value up (ECS injects secrets at task START, so a running task holds the
// stale one). The token is write-only: it is never logged, returned, or read back.
// The caller's Cognito identity is verified upstream in the router.
//
// AWS clients are injectable for tests; in the Lambda they are created lazily from
// the runtime-bundled SDK (same pattern as the rest of the BFF).

export function makeSettings({ region, githubTokenSecretArn, cluster, service, clients = null }) {
  let _clients = clients;
  async function awsClients() {
    if (_clients) return _clients;
    const { SecretsManagerClient, PutSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
    const { ECSClient, UpdateServiceCommand } = await import("@aws-sdk/client-ecs");
    const sm = new SecretsManagerClient({ region });
    const ecs = new ECSClient({ region });
    _clients = {
      putSecretValue: (args) => sm.send(new PutSecretValueCommand(args)),
      updateService: (args) => ecs.send(new UpdateServiceCommand(args)),
    };
    return _clients;
  }

  return {
    // Store the token and restart Mission Control. Returns { ok, restarted } — NEVER
    // the token. Throws { statusCode, code } for a bad request.
    async setGithubToken(token) {
      if (typeof token !== "string" || token.trim() === "") {
        const e = new Error("a non-empty token is required");
        e.statusCode = 400;
        e.code = "invalid_token";
        throw e;
      }
      const c = await awsClients();
      await c.putSecretValue({ SecretId: githubTokenSecretArn, SecretString: token.trim() });
      // Restart so the running task re-reads the secret (injected at task start).
      await c.updateService({ cluster, service, forceNewDeployment: true });
      return { ok: true, restarted: true };
    },
  };
}
