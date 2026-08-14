// Mirror git working-tree state to the S3 corpus bucket and trigger a KB sync, so
// the Knowledge Base grounds on the git source of truth. Pure logic with an
// injected store (the real S3 + Bedrock client lives in store.ts) and a minimal
// view of the vault, so it is unit-testable with fakes.

// S3 user metadata stamped on a mirrored object so the vault UI can attribute a
// note to a person (read back by the BFF as updated-by / updated-by-id / updated-at).
export type ObjectMeta = Record<string, string>;

export interface MirrorStore {
  listKeys(): Promise<string[]>;
  putObject(key: string, body: string, metadata?: ObjectMeta): Promise<void>;
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

  // Mirror a single changed file (git -> S3). Optional metadata attributes the
  // change to a person; the periodic full() sync passes none (git remains the
  // source of truth for authorship, S3 metadata is a best-effort convenience).
  async put(path: string, metadata?: ObjectMeta): Promise<void> {
    const content = await this.vault.read(path);
    await this.store.putObject(path, content, metadata);
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

  // Best-effort KB sync; a lagging or already-running ingestion never fails a write.
  async reingest(): Promise<void> {
    await this.store.reingest().catch(() => {});
  }
}
