# web

The Homebase GUI: a React + TypeScript SPA (Vite). Cognito + Google login via the hosted UI
(authorization-code + PKCE, no client secret), and a streaming chat interface that renders tokens,
tool-call events, and citations from the BFF.

## Streaming: fetch + ReadableStream (not EventSource)

The SSE stream is consumed with `fetch` + `response.body.getReader()` (`src/api/sseClient.ts`), NOT
`EventSource`. EventSource cannot issue a POST and cannot send an `Authorization` header, both of
which this endpoint requires (the prompt is POSTed with the Cognito bearer token).

## Config is env-injected, never committed

All identity and API config is read from `VITE_` env vars at build/runtime (`src/config.ts`): user
pool id, client id, hosted-UI domain, redirect/logout URIs, and API base URL. Nothing is hardcoded,
so the built bundle contains no real identifiers from this public repo. See `.env.example` for the
(placeholder) shape; copy it to `.env.local` for local dev, or inject in CI.

## Tokens in the browser

Authorization-code + PKCE with no client secret. Tokens are held in `sessionStorage` and refreshed
before expiry (`src/auth/useAuth.ts`); the access token is attached as the `Authorization` bearer on
every streaming fetch call, refreshed first if it is close to expiring.

## Mobile-first

The layout is a single column filling `100dvh`, a scrollable transcript, and a bottom-pinned composer
with safe-area insets, 44px+ touch targets, and a 16px input font (avoids iOS zoom-on-focus). The
phone is a primary device, not an afterthought.

## Develop, build, test

```bash
cd web
npm install
npm run dev        # local dev (needs .env.local)
npm run build      # type-check + production bundle to dist/
npm test           # vitest component + unit tests (jsdom)
```

The build output `dist/` is uploaded to the private S3 origin (see `infra/stacks/web`) and served via
CloudFront; `dist/` is git-ignored.
