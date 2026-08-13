// Mirror git working-tree state to the S3 corpus bucket and trigger a KB sync, so
// the Knowledge Base grounds on the git source of truth. Pure logic with an
// injected store (the real S3 + Bedrock client lives in store.ts) and a minimal
// view of the vault, so it is unit-testable with fakes.

export interface MirrorStore {
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

  // Mirror a single changed file (git -> S3).
  async put(path: string): Promise<void> {
    const content = await this.vault.read(path);
    await this.store.putObject(path, content);
  }

  async remove(path: string): Promise<void> {
    await this.store.deleteObject(path);
  }

  // Mirror every note (used after pulling external commits). Sequential: the vault
  // is small and this runs off the request path.
  async full(): Promise<number> {
    const files = await this.vault.list();
    for (const f of files) await this.put(f);
    return files.length;
  }

  // Best-effort KB sync; a lagging or already-running ingestion never fails a write.
  async reingest(): Promise<void> {
    await this.store.reingest().catch(() => {});
  }
}
