// Entry point: own the git clone, mirror git -> S3 -> KB on start and on a poll
// interval (picks up commits from other writers), and serve the internal write API.

import { loadConfig } from "./config.ts";
import { GitVault } from "./gitvault.ts";
import { Mirror } from "./mirror.ts";
import { makeStore } from "./store.ts";
import { createServer } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const vault = new GitVault({
    workDir: config.workDir,
    remoteUrl: config.remoteUrl,
    token: config.token,
    branch: config.branch,
    committer: config.committer,
  });
  await vault.init();

  const store = await makeStore({
    region: config.region,
    bucket: config.corpusBucket,
    kbId: config.kbId,
    kbDataSourceId: config.kbDataSourceId,
  });
  const mirror = new Mirror(store, vault);

  // Initial sync so the KB reflects the current git state (prune + put).
  const { mirrored, pruned } = await mirror.full();
  await mirror.reingest();
  console.log(JSON.stringify({ event: "vault_ready", mirrored, pruned, branch: config.branch }));

  createServer({ config, vault, mirror }).listen(config.port, () => {
    console.log(JSON.stringify({ event: "listening", port: config.port }));
  });

  // Pull external commits (other users/clients) and mirror them.
  setInterval(async () => {
    try {
      await vault.pull();
      await mirror.full();
      await mirror.reingest();
    } catch (err) {
      console.error(JSON.stringify({ event: "pull_error", message: String((err as Error)?.message).slice(0, 300) }));
    }
  }, config.pullIntervalMs);
}

main().catch((err) => {
  console.error(JSON.stringify({ event: "fatal", message: String(err?.message || err) }));
  process.exit(1);
});
