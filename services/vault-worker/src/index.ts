// Entry point: own the git clone, mirror git -> S3 -> KB on start and on a poll
// interval (picks up commits from other writers), and serve the internal write API.

import { loadConfig } from "./config.ts";
import { GitVault } from "./gitvault.ts";
import { Mirror } from "./mirror.ts";
import { Mutex } from "./mutex.ts";
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
  // One mutex serializes every git-touching operation (writes + the poll loop).
  const mutex = new Mutex();

  // Initial sync so the KB reflects the current git state (prune + put).
  const { mirrored, pruned } = await mirror.full();
  await mirror.reingest();
  console.log(JSON.stringify({ event: "vault_ready", mirrored, pruned, branch: config.branch }));

  createServer({ config, vault, mirror, mutex }).listen(config.port, () => {
    console.log(JSON.stringify({ event: "listening", port: config.port }));
  });

  // Pull external commits (other users/clients) and mirror them, serialized against
  // in-flight writes so git operations never overlap on the one clone.
  setInterval(() => {
    void mutex
      .run(async () => {
        const before = await vault.head();
        await vault.pull();
        const after = await vault.head();
        // Common case: nothing new landed -> touch neither S3 nor the KB. Re-putting
        // every object every poll piled up millions of noncurrent versions on the
        // versioned bucket (and ran a pointless reingest each time).
        if (before && after && before === after) return;
        // Safety: if either commit is unresolvable, fall back to a full reconcile.
        if (!before || !after) {
          const r = await mirror.full();
          await mirror.reingest();
          console.log(JSON.stringify({ event: "vault_synced", mode: "full", mirrored: r.mirrored, pruned: r.pruned }));
          return;
        }
        // Otherwise mirror only what changed between the two commits.
        const { changed, deleted } = await vault.changedFiles(before, after);
        if (changed.length === 0 && deleted.length === 0) return;
        const r = await mirror.sync(changed, deleted);
        await mirror.reingest();
        console.log(JSON.stringify({ event: "vault_synced", mode: "diff", mirrored: r.mirrored, pruned: r.pruned, from: before, to: after }));
      })
      .catch((err) => {
        // Enrich the log: transient S3/network errors often carry their detail in
        // name/code/cause rather than message (an empty message told us nothing).
        const e = err as { message?: string; name?: string; code?: string; cause?: unknown };
        const cause = e?.cause as { message?: string; code?: string } | undefined;
        const detail = e?.message || e?.code || cause?.message || cause?.code || String(err);
        console.error(
          JSON.stringify({ event: "pull_error", name: e?.name, code: e?.code, message: String(detail).slice(0, 300) }),
        );
      });
  }, config.pullIntervalMs);
}

main().catch((err) => {
  console.error(JSON.stringify({ event: "fatal", message: String(err?.message || err) }));
  process.exit(1);
});
