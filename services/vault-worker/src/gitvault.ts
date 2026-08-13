// Git operations over the vault working clone. Shells to `git` (installed in the
// container) so rebase/merge behave exactly as git does. All network calls carry
// the auth header via git's env-based config, so the token is never in argv or on
// disk (.git/config).
//
// Write policy (the conflict contract): pull-rebase to latest, write, commit with
// the caller as author, push. On a non-fast-forward push, rebase and retry; on a
// true conflict (the same file changed upstream), abort and preserve upstream,
// writing the caller's content to a *.conflict-<stamp>.md copy that is surfaced.
// A note is never silently overwritten.

import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Actor {
  name: string;
  email: string;
}

export interface WriteResult {
  ok: true;
  changed: boolean;
  commit: string | null;
  conflictPath?: string;
}

export interface GitVaultOptions {
  workDir: string;
  remoteUrl: string;
  token?: string | null;
  committer?: Actor;
  branch?: string;
  stamp?: () => string;
  // Test seam: invoked once right before the first push, to simulate another writer
  // advancing the remote (forcing the non-fast-forward / conflict path).
  hooks?: { beforePush?: () => Promise<void> };
}

function assertSafePath(path: string): string {
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\0")) {
    throw Object.assign(new Error("invalid path"), { code: "invalid_path", status: 400 });
  }
  return path;
}

function conflictName(path: string, stamp: string): string {
  const m = /^(.*?)(\.[^./]+)?$/.exec(path)!;
  const base = m[1];
  const ext = m[2] ?? "";
  return `${base}.conflict-${stamp}${ext}`;
}

export class GitVault {
  readonly workDir: string;
  private readonly remoteUrl: string;
  private readonly token: string | null;
  private readonly committer: Actor;
  readonly branch: string;
  private readonly stamp: () => string;
  private beforePush?: () => Promise<void>;

  constructor(opts: GitVaultOptions) {
    this.workDir = opts.workDir;
    this.remoteUrl = opts.remoteUrl;
    this.token = opts.token ?? null;
    this.committer = opts.committer ?? { name: "Homebase", email: "homebase@localhost" };
    this.branch = opts.branch ?? "main";
    this.stamp = opts.stamp ?? (() => new Date().toISOString().replace(/[:.]/g, "-"));
    this.beforePush = opts.hooks?.beforePush;
  }

  // Run a git command, returning code+stdout+stderr without throwing so callers can
  // inspect failures (for example a non-fast-forward push).
  private async git(args: string[], cwd = this.workDir): Promise<{ code: number; stdout: string; stderr: string }> {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    if (this.token) {
      const basic = Buffer.from(`x-access-token:${this.token}`).toString("base64");
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = "http.extraheader";
      env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
    }
    try {
      const { stdout, stderr } = await run("git", args, { cwd, env, maxBuffer: 32 * 1024 * 1024 });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(err) };
    }
  }

  private async gitOrThrow(args: string[], cwd = this.workDir): Promise<string> {
    const r = await this.git(args, cwd);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
    return r.stdout.trim();
  }

  // Clone the repo if the working dir is not yet a clone; otherwise fetch. Sets the
  // committer identity used for merge/rebase commits.
  async init(): Promise<void> {
    if (!existsSync(join(this.workDir, ".git"))) {
      await mkdir(dirname(this.workDir), { recursive: true });
      const clone = await this.git(["clone", "--branch", this.branch, this.remoteUrl, this.workDir], dirname(this.workDir) || ".");
      if (clone.code !== 0) throw new Error(`clone failed: ${clone.stderr}`);
    } else {
      await this.git(["fetch", "origin", this.branch]);
    }
    await this.gitOrThrow(["config", "user.name", this.committer.name]);
    await this.gitOrThrow(["config", "user.email", this.committer.email]);
  }

  async head(): Promise<string | null> {
    const r = await this.git(["rev-parse", "HEAD"]);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  // Fast-forward the local branch to the remote. The working tree is clean and has
  // no unpushed commits at this point, so this cannot conflict.
  async pull(): Promise<void> {
    await this.git(["fetch", "origin", this.branch]);
    const r = await this.git(["rebase", `origin/${this.branch}`]);
    if (r.code !== 0) await this.git(["rebase", "--abort"]);
  }

  async read(path: string): Promise<string> {
    assertSafePath(path);
    return readFile(join(this.workDir, path), "utf8");
  }

  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (rel: string) => {
      const entries = await readdir(join(this.workDir, rel), { withFileTypes: true });
      for (const e of entries) {
        if (e.name === ".git") continue;
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(child);
        else if (/\.(md|markdown)$/i.test(e.name)) out.push(child);
      }
    };
    await walk("");
    return out.sort();
  }

  async writeNote({ path, content, author, message }: { path: string; content: string; author: Actor; message: string }): Promise<WriteResult> {
    assertSafePath(path);
    await this.pull();
    await this.writeWorkingFile(path, content);
    await this.gitOrThrow(["add", "--", path]);
    const commit = await this.git(["commit", "--author", `${author.name} <${author.email}>`, "-m", message]);
    if (commit.code !== 0) {
      if (/nothing to commit/i.test(commit.stdout + commit.stderr)) return { ok: true, changed: false, commit: await this.head() };
      throw new Error(`commit failed: ${commit.stderr || commit.stdout}`);
    }
    return this.pushWithPolicy(path, content, author);
  }

  async deleteNote({ path, author, message }: { path: string; author: Actor; message: string }): Promise<WriteResult> {
    assertSafePath(path);
    await this.pull();
    const rm = await this.git(["rm", "--", path]);
    if (rm.code !== 0) {
      if (/did not match any files/i.test(rm.stderr)) return { ok: true, changed: false, commit: await this.head() };
      throw new Error(`rm failed: ${rm.stderr}`);
    }
    await this.gitOrThrow(["commit", "--author", `${author.name} <${author.email}>`, "-m", message]);
    const push = await this.git(["push", "origin", this.branch]);
    if (push.code === 0) return { ok: true, changed: true, commit: await this.head() };
    // Let a delete lose to a concurrent edit: rebase and retry, surfacing nothing fancy.
    await this.git(["fetch", "origin", this.branch]);
    const rebase = await this.git(["rebase", `origin/${this.branch}`]);
    if (rebase.code !== 0) await this.git(["rebase", "--abort"]);
    await this.gitOrThrow(["push", "origin", this.branch]);
    return { ok: true, changed: true, commit: await this.head() };
  }

  private async writeWorkingFile(path: string, content: string): Promise<void> {
    const full = resolve(this.workDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  // Push the just-created commit. On non-fast-forward, rebase and retry; on a true
  // conflict, preserve upstream and save the caller's content as a conflict copy.
  private async pushWithPolicy(path: string, content: string, author: Actor): Promise<WriteResult> {
    if (this.beforePush) {
      const hook = this.beforePush;
      this.beforePush = undefined; // one-shot
      await hook();
    }
    const push = await this.git(["push", "origin", this.branch]);
    if (push.code === 0) return { ok: true, changed: true, commit: await this.head() };

    await this.git(["fetch", "origin", this.branch]);
    const rebase = await this.git(["rebase", `origin/${this.branch}`]);
    if (rebase.code !== 0) {
      // Same file changed upstream: abort, keep upstream, write a conflict copy.
      await this.git(["rebase", "--abort"]);
      await this.gitOrThrow(["reset", "--hard", `origin/${this.branch}`]);
      const conflictPath = conflictName(path, this.stamp());
      await this.writeWorkingFile(conflictPath, content);
      await this.gitOrThrow(["add", "--", conflictPath]);
      await this.gitOrThrow(["commit", "--author", `${author.name} <${author.email}>`, "-m", `conflict copy for ${path}`]);
      await this.gitOrThrow(["push", "origin", this.branch]);
      return { ok: true, changed: true, commit: await this.head(), conflictPath };
    }
    await this.gitOrThrow(["push", "origin", this.branch]);
    return { ok: true, changed: true, commit: await this.head() };
  }
}
