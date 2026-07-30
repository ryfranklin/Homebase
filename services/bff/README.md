# services/bff

The streaming backend for frontend (BFF): a Lambda that validates the Cognito JWT, then invokes the
AgentCore runtime and streams tokens and tool-call events straight through to the browser as
server-sent events (SSE).

## Why a Lambda Function URL (not API Gateway)

API Gateway HTTP APIs buffer responses and do not stream. (REST APIs gained response streaming in
late 2025, but with limits.) Lambda Function URLs support response streaming via
`InvokeMode = RESPONSE_STREAM`. So the streaming endpoint is a Function URL, never behind API Gateway.

Response streaming on managed runtimes is Node.js only (Python has no native Function URL streaming
path), which is why this service is Node.js while the rest of Homebase is Python. The handler is
wrapped with `awslambda.streamifyResponse`.

## Function URL auth: NONE, with in-function JWT validation

`authorization_type = "NONE"`, and the handler validates the Cognito JWT itself. Why not `AWS_IAM`
with CloudFront OAC:

- The chat request is a POST with a body. With `AWS_IAM` + OAC, AWS requires the caller to send an
  `x-amz-content-sha256` of the body ("Lambda doesn't support unsigned payloads"), which is hostile
  to a streaming chat POST.
- OAC only proves the request came from our CloudFront distribution; it does not authenticate the
  Cognito user. We would still need the in-function JWT check regardless.

So the in-function JWT check is the gate, and CloudFront still fronts the Function URL (P8). If you
later want to block direct-to-origin access, the `AWS_IAM` + OAC path is a documented seam in
`infra/stacks/api` (keep streamed requests body-less/GET to avoid the signing caveat).

## JWT validation (in-function, real)

`jwt.mjs` verifies the RS256 signature against the pool JWKS, then checks issuer, audience (`aud`
for id tokens or `client_id` for access tokens), and expiry. Issuer, audience, and the JWKS URI all
come from configuration sourced from SSM (P3 outputs), never literals. Per-user and per-tenant
scoping is enforced from the claims (`sub` and `custom:tenant_id`); if the request body names a
different tenant or user, the request is rejected rather than honored.

## Config (env, from SSM via the api Terraform stack)

`HOMEBASE_ISSUER`, `HOMEBASE_AUDIENCE`, `HOMEBASE_AGENT_RUNTIME_ARN`, `HOMEBASE_ALLOWED_ORIGIN`,
`AWS_REGION`.

## Origin contract for CloudFront (P8)

CloudFront routes `/api/*` to the Function URL origin. Requests are POST with a JSON body
(`{ input, session_id? }`) and an `Authorization: Bearer <token>` header; the response is
`text/event-stream`. CORS is restricted to the SPA origin.

## Tests

```bash
cd services/bff
node --test        # offline: RSA keys generated in-process, fake JWTs, mock agent stream
```
