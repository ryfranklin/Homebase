import { describe, expect, it } from "vitest";

import { Mirror, type MirrorStore, type VaultView } from "../src/mirror.ts";

function fakeStore(existing: string[] = []) {
  const puts: [string, string][] = [];
  const deletes: string[] = [];
  let reingests = 0;
  let throwOnReingest = false;
  const store: MirrorStore & {
    puts: typeof puts;
    deletes: typeof deletes;
    reingests: () => number;
    setThrow: (v: boolean) => void;
  } = {
    puts,
    deletes,
    reingests: () => reingests,
    setThrow: (v) => (throwOnReingest = v),
    async listKeys() {
      return existing;
    },
    async putObject(key, body) {
      puts.push([key, body]);
    },
    async deleteObject(key) {
      deletes.push(key);
    },
    async reingest() {
      if (throwOnReingest) throw new Error("conflict");
      reingests += 1;
    },
  };
  return store;
}

function fakeVault(files: Record<string, string>): VaultView {
  return {
    async read(p) {
      return files[p];
    },
    async list() {
      return Object.keys(files);
    },
  };
}

describe("Mirror", () => {
  it("puts a single changed file (git -> S3)", async () => {
    const store = fakeStore();
    const m = new Mirror(store, fakeVault({ "a.md": "hello" }));
    await m.put("a.md");
    expect(store.puts).toEqual([["a.md", "hello"]]);
  });

  it("removes a file", async () => {
    const store = fakeStore();
    const m = new Mirror(store, fakeVault({}));
    await m.remove("gone.md");
    expect(store.deletes).toEqual(["gone.md"]);
  });

  it("full sync mirrors every note", async () => {
    const store = fakeStore();
    const m = new Mirror(store, fakeVault({ "a.md": "A", "b/c.md": "C" }));
    const { mirrored } = await m.full();
    expect(mirrored).toBe(2);
    expect(store.puts.map(([k]) => k).sort()).toEqual(["a.md", "b/c.md"]);
  });

  it("full sync prunes S3 objects that no longer exist in git", async () => {
    // S3 has two stale notes; git has only a.md.
    const store = fakeStore(["a.md", "old/gone.md", "stale.md"]);
    const m = new Mirror(store, fakeVault({ "a.md": "A" }));
    const { mirrored, pruned } = await m.full();
    expect(mirrored).toBe(1);
    expect(pruned).toBe(2);
    expect(store.deletes.sort()).toEqual(["old/gone.md", "stale.md"]);
    expect(store.puts.map(([k]) => k)).toEqual(["a.md"]);
  });

  it("reingest is best-effort and never throws", async () => {
    const store = fakeStore();
    store.setThrow(true);
    const m = new Mirror(store, fakeVault({}));
    await expect(m.reingest()).resolves.toBeUndefined();
  });
});
