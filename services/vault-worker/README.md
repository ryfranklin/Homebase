# services/vault-worker

The always-on worker that makes the **git vault the source of truth**. It owns the
canonical clone of the vault repo, serves the internal write API, and mirrors
**git -> S3 -> Knowledge Base** so retrieval grounds on git.

This is step one of the git reorientation. The vault repo is a fresh private
GitHub repo (Homebase's own vault, separate from your Obsidian vault until the
platform is proven).

## What it does

- **Owns the clone.** On start it clones the repo and mirrors every note to the S3
  corpus bucket, then triggers a KB ingestion. On a poll interval it pulls commits
  from other writers and re-mirrors.
- **Serves writes** (internal HTTP, shared-secret gated): `POST /write`,
  `POST /delete`, `POST /pull`, `GET /file`, `GET /health`.
- **Conflict policy** (see `src/gitvault.ts`): pull-rebase to latest, commit with
  the caller as git author, push. On a non-fast-forward push, rebase and retry; on
  a true conflict (same file changed upstream), preserve upstream and save the
  caller's content to a `*.conflict-<stamp>.md` copy. A note is never silently
  overwritten. The token is injected via git's env config, never in argv or on disk.

## Design

- `gitvault.ts` shells to `git` so rebase/merge behave exactly as git does.
- `mirror.ts` is pure (injected store), so it is unit-testable with fakes;
  `store.ts` is the real S3 + Bedrock client (AWS SDK from the container image).
- `server.ts` is the internal API; `index.ts` wires it and runs the pull loop.

## Local dev

```bash
cd services/vault-worker
npm install
npm run typecheck
npm test          # GitVault runs against throwaway local repos; no network, no AWS
```

## Runtime configuration (env)

`VAULT_REMOTE_URL`, `HOMEBASE_CORPUS_BUCKET` are required. `GITHUB_TOKEN` and
`WORKER_SHARED_SECRET` arrive as ECS secrets from Secrets Manager. Optional:
`VAULT_WORK_DIR`, `VAULT_BRANCH`, `HOMEBASE_KB_ID`, `HOMEBASE_KB_DATA_SOURCE_ID`,
`AWS_REGION`, `VAULT_PULL_INTERVAL_MS`, `PORT`, `GIT_COMMITTER_NAME/EMAIL`.

## Human setup (before deploy)

1. Create a private GitHub repo for the vault; seed it with a README on `main`.
2. Create a fine-grained PAT scoped to that repo with Contents read/write.
3. Store the PAT in Secrets Manager (the vault-worker Terraform references it).

The Terraform for the Fargate service and IAM lives in `infra/stacks/vault-worker`.
