// Loads the origin shared secret from Secrets Manager at runtime, returning both
// the current and pending values so a rotation is accepted during its window.
// The client is injected so tests need no AWS; the handler builds the real one.

export async function loadOriginSecrets(secretsClient, secretId) {
  const values = [];
  for (const stage of ["AWSCURRENT", "AWSPENDING"]) {
    try {
      const out = await secretsClient.getSecretValue({ SecretId: secretId, VersionStage: stage });
      if (out?.SecretString) values.push(out.SecretString);
    } catch {
      // AWSPENDING may not exist outside a rotation window; ignore.
    }
  }
  return values;
}

// Small TTL cache so the BFF does not call Secrets Manager on every request.
export function cachedOriginSecrets(secretsClient, secretId, { ttlMs = 300_000, now = () => Date.now() } = {}) {
  let cache = [];
  let expiresAt = 0;
  return async () => {
    if (now() < expiresAt && cache.length) return cache;
    cache = await loadOriginSecrets(secretsClient, secretId);
    expiresAt = now() + ttlMs;
    return cache;
  };
}
