// Runtime config from environment. The GitHub token and the internal shared secret
// arrive as ECS secrets (from Secrets Manager); nothing is a literal here.

export interface WorkerConfig {
  workDir: string;
  remoteUrl: string;
  token: string | null;
  branch: string;
  committer: { name: string; email: string };
  corpusBucket: string;
  kbId: string | null;
  kbDataSourceId: string | null;
  region: string | undefined;
  sharedSecret: string | null;
  pullIntervalMs: number;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const required = ["VAULT_REMOTE_URL", "HOMEBASE_CORPUS_BUCKET"];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing required env: ${missing.join(", ")}`);
  return {
    workDir: env.VAULT_WORK_DIR || "/data/vault",
    remoteUrl: env.VAULT_REMOTE_URL!,
    token: env.GITHUB_TOKEN || null,
    branch: env.VAULT_BRANCH || "main",
    committer: {
      name: env.GIT_COMMITTER_NAME || "Homebase",
      email: env.GIT_COMMITTER_EMAIL || "homebase@localhost",
    },
    corpusBucket: env.HOMEBASE_CORPUS_BUCKET!,
    kbId: env.HOMEBASE_KB_ID || null,
    kbDataSourceId: env.HOMEBASE_KB_DATA_SOURCE_ID || null,
    region: env.AWS_REGION,
    sharedSecret: env.WORKER_SHARED_SECRET || null,
    pullIntervalMs: Number(env.VAULT_PULL_INTERVAL_MS || 60000),
    port: Number(env.PORT || 8080),
  };
}
