// Internal HTTP API for the vault worker. VPC-internal; callers (the BFF) present a
// shared secret. Writes go through GitVault (pull-rebase, commit-as-author, push,
// conflict policy); after any change the affected files are mirrored to S3 and a KB
// sync is triggered.

import { createServer as httpCreateServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import type { WorkerConfig } from "./config.ts";
import type { GitVault } from "./gitvault.ts";
import type { Mirror } from "./mirror.ts";
import type { Mutex } from "./mutex.ts";

export interface ServerDeps {
  config: WorkerConfig;
  vault: GitVault;
  mirror: Mirror;
  mutex: Mutex;
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createServer({ config, vault, mirror, mutex }: ServerDeps): Server {
  return httpCreateServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://worker");
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/health") return json(res, 200, { ok: true });

    // Shared-secret gate for everything else.
    if (config.sharedSecret) {
      const provided = (req.headers["x-worker-secret"] as string) ?? "";
      if (!constantTimeEqual(provided, config.sharedSecret)) return json(res, 403, { error: "forbidden" });
    }

    try {
      if (method === "GET" && path === "/file") {
        const p = url.searchParams.get("path") ?? "";
        return json(res, 200, { path: p, content: await vault.read(p) });
      }

      if (method === "POST" && path === "/write") {
        const body = await readBody(req);
        const author = (body.author as { name: string; email: string; id?: string }) ?? config.committer;
        // Attribute the mirrored object to the caller so the vault UI can show who
        // last changed a note (git stays the authoritative record of authorship).
        const meta = {
          "updated-by": author.name ?? "",
          "updated-by-id": author.id ?? "",
          "updated-at": new Date().toISOString(),
        };
        const result = await mutex.run(async () => {
          const r = await vault.writeNote({
            path: String(body.path ?? ""),
            content: String(body.content ?? ""),
            author,
            message: String(body.message ?? "update note"),
          });
          if (r.changed) {
            await mirror.put(r.conflictPath ?? String(body.path), meta);
            if (r.conflictPath) await mirror.put(String(body.path), meta);
            await mirror.reingest();
          }
          return r;
        });
        return json(res, 200, result);
      }

      if (method === "POST" && path === "/delete") {
        const body = await readBody(req);
        const p = String(body.path ?? "");
        const result = await mutex.run(async () => {
          const r = await vault.deleteNote({
            path: p,
            author: (body.author as { name: string; email: string }) ?? config.committer,
            message: String(body.message ?? "delete note"),
          });
          if (r.changed) {
            await mirror.remove(p);
            await mirror.reingest();
          }
          return r;
        });
        return json(res, 200, result);
      }

      if (method === "POST" && path === "/pull") {
        const result = await mutex.run(async () => {
          await vault.pull();
          const r = await mirror.full();
          await mirror.reingest();
          return r;
        });
        return json(res, 200, { ok: true, ...result });
      }

      return json(res, 404, { error: "not_found" });
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string };
      const status = e.status ?? 500;
      if (status >= 500) console.error(JSON.stringify({ event: "worker_error", path, message: String(e.message).slice(0, 300) }));
      return json(res, status, { error: e.code ?? "worker_error", message: status >= 500 ? "internal error" : e.message });
    }
  });
}
