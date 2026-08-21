// Mirror git working-tree state to the S3 corpus bucket and trigger a KB sync, so
// the Knowledge Base grounds on the git source of truth. Pure logic with an
// injected store (the real S3 + Bedrock client lives in store.ts) and a minimal
// view of the vault, so it is unit-testable with fakes.

export interface MirrorStore {
  listKeys(): Promise<string[]>;
  putObject(key: string, body: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  reingest(): Promise<void>;
}

export interface VaultView {
  read(path: string): Promise<string>;
  list(): Promise<string[]>;
}

export class Mirror {
  constructor(
    private readonly store: MirrorStore,
    private readonly vault: VaultView,
  ) {}

  // Mirror a single changed file (git -> S3). Authorship is not stamped here: the
  // S3 mirror is rebuilt on every sync, so authorship is read from git instead.
  async put(path: string): Promise<void> {
    const content = await this.vault.read(path);
    await this.store.putObject(path, content);
  }

  async remove(path: string): Promise<void> {
    await this.store.deleteObject(path);
  }

  // Make S3 faithfully reflect git: delete objects that no longer exist in git
  // (prune), then put every git note. Sequential: the vault is small and this runs
  // off the request path. The subsequent reingest removes pruned docs from the KB.
  async full(): Promise<{ mirrored: number; pruned: number }> {
    const files = await this.vault.list();
    const gitSet = new Set(files);
    const s3Keys = await this.store.listKeys();
    let pruned = 0;
    for (const key of s3Keys) {
      if (!gitSet.has(key)) {
        await this.store.deleteObject(key);
        pruned += 1;
      }
    }
    for (const f of files) await this.put(f);
    return { mirrored: files.length, pruned };
  }

  // Mirror only the files that changed between two git commits: upsert the changed
  // notes, delete the removed ones. The poll loop uses this instead of full() so an
  // unchanged (or lightly changed) vault does not re-put every object every cycle —
  // which was creating a new S3 version of every file on every poll.
  async sync(changed: string[], deleted: string[]): Promise<{ mirrored: number; pruned: number }> {
    for (const key of deleted) await this.store.deleteObject(key);
    for (const f of changed) await this.put(f);
    return { mirrored: changed.length, pruned: deleted.length };
  }

  // Best-effort KB sync; a lagging or already-running ingestion never fails a write.
  async reingest(): Promise<void> {
    await this.store.reingest().catch(() => {});
  }
}
