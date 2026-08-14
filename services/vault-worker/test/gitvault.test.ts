import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { GitVault } from "../src/gitvault.ts";

const author = { name: "ryan", email: "ryan@test" };
const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// A bare "remote" seeded with a main branch and one commit.
function makeRemote(): { root: string; remote: string } {
  const root = mkdtempSync(join(tmpdir(), "vw-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remote]);
  const seed = join(root, "seed");
  execFileSync("git", ["init", "-b", "main", seed]);
  git(seed, "config", "user.email", "seed@test");
  git(seed, "config", "user.name", "seed");
  git(seed, "remote", "add", "origin", remote);
  writeFileSync(join(seed, "README.md"), "# vault\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "init");
  git(seed, "push", "-u", "origin", "main");
  return { root, remote };
}

// Simulate another writer advancing the remote.
function advanceRemote(remote: string, path: string, content: string): void {
  const dir = mkdtempSync(join(tmpdir(), "vw-adv-"));
  roots.push(dir);
  execFileSync("git", ["clone", "--branch", "main", remote, dir]);
  git(dir, "config", "user.email", "other@test");
  git(dir, "config", "user.name", "other");
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
  git(dir, "add", ".");
  git(dir, "commit", "-m", `advance ${path}`);
  git(dir, "push", "origin", "main");
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("GitVault", () => {
  it("writes a note and another clone sees it after pull", async () => {
    const { root, remote } = makeRemote();
    const v1 = new GitVault({ workDir: join(root, "v1"), remoteUrl: remote, branch: "main" });
    await v1.init();
    await v1.writeNote({ path: "notes/a.md", content: "hello", author, message: "add a" });

    const v2 = new GitVault({ workDir: join(root, "v2"), remoteUrl: remote, branch: "main" });
    await v2.init();
    expect(await v2.read("notes/a.md")).toBe("hello");
    expect(await v2.list()).toContain("notes/a.md");
  });

  it("records the commit author", async () => {
    const { root, remote } = makeRemote();
    const v1 = new GitVault({ workDir: join(root, "v1"), remoteUrl: remote, branch: "main" });
    await v1.init();
    await v1.writeNote({ path: "a.md", content: "x", author, message: "add a" });
    const log = git(join(root, "v1"), "log", "-1", "--format=%an <%ae>");
    expect(log).toBe("ryan <ryan@test>");
  });

  it("a concurrent write to a DIFFERENT file rebases cleanly (both land)", async () => {
    const { root, remote } = makeRemote();
    const v1 = new GitVault({
      workDir: join(root, "v1"),
      remoteUrl: remote,
      branch: "main",
      hooks: { beforePush: async () => advanceRemote(remote, "other.md", "other") },
    });
    await v1.init();
    const res = await v1.writeNote({ path: "mine.md", content: "mine", author, message: "mine" });
    expect(res.conflictPath).toBeUndefined();

    const v2 = new GitVault({ workDir: join(root, "v2"), remoteUrl: remote, branch: "main" });
    await v2.init();
    expect(await v2.read("mine.md")).toBe("mine");
    expect(await v2.read("other.md")).toBe("other");
  });

  it("a concurrent write to the SAME file writes a conflict copy, upstream preserved", async () => {
    const { root, remote } = makeRemote();
    const v1 = new GitVault({
      workDir: join(root, "v1"),
      remoteUrl: remote,
      branch: "main",
      stamp: () => "S",
      hooks: { beforePush: async () => advanceRemote(remote, "dup.md", "REMOTE") },
    });
    await v1.init();
    const res = await v1.writeNote({ path: "dup.md", content: "LOCAL", author, message: "local" });
    expect(res.conflictPath).toBe("dup.conflict-S.md");

    const v2 = new GitVault({ workDir: join(root, "v2"), remoteUrl: remote, branch: "main" });
    await v2.init();
    expect(await v2.read("dup.md")).toBe("REMOTE"); // upstream preserved
    expect(await v2.read("dup.conflict-S.md")).toBe("LOCAL"); // caller's content saved
  });

  it("log returns per-file history newest-first with authors, and readAt reads a prior version", async () => {
    const { root, remote } = makeRemote();
    const v1 = new GitVault({ workDir: join(root, "v1"), remoteUrl: remote, branch: "main" });
    await v1.init();
    await v1.writeNote({ path: "h.md", content: "v1", author: { name: "alice", email: "alice@test" }, message: "first" });
    await v1.writeNote({ path: "h.md", content: "v2", author: { name: "bob", email: "bob@test" }, message: "second" });

    const log = await v1.log("h.md");
    expect(log.length).toBe(2);
    expect(log[0].authorName).toBe("bob"); // newest first
    expect(log[0].isCurrent).toBe(true);
    expect(log[1].authorName).toBe("alice");
    expect(log[1].isCurrent).toBe(false);

    // readAt the older commit returns the original content; current read returns v2.
    expect(await v1.readAt("h.md", log[1].commit)).toBe("v1");
    expect(await v1.read("h.md")).toBe("v2");
  });

  it("readAt rejects a non-hash ref (no option/path injection)", async () => {
    const { root, remote } = makeRemote();
    const v1 = new GitVault({ workDir: join(root, "v1"), remoteUrl: remote, branch: "main" });
    await v1.init();
    await v1.writeNote({ path: "h.md", content: "x", author, message: "add" });
    await expect(v1.readAt("h.md", "--output=/tmp/pwn")).rejects.toMatchObject({ code: "invalid_version" });
    await expect(v1.readAt("h.md", "HEAD")).rejects.toMatchObject({ code: "invalid_version" });
  });

  it("deletes a note", async () => {
    const { root, remote } = makeRemote();
    const v1 = new GitVault({ workDir: join(root, "v1"), remoteUrl: remote, branch: "main" });
    await v1.init();
    await v1.writeNote({ path: "del.md", content: "x", author, message: "add" });
    await v1.deleteNote({ path: "del.md", author, message: "del" });

    const v2 = new GitVault({ workDir: join(root, "v2"), remoteUrl: remote, branch: "main" });
    await v2.init();
    expect(await v2.list()).not.toContain("del.md");
  });
});
