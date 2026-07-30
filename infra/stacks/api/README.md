# stacks/api

The API tier: a streaming Lambda BFF exposed via a Lambda Function URL. State lives remotely in the
bootstrap bucket.

## What it creates

- The Node.js BFF Lambda (packaged from `services/bff/src`), with issuer, audience, allowed origin,
  and the AgentCore runtime ARN passed as environment variables from SSM (P3 and P6 outputs), never
  literals.
- A Lambda Function URL with `invoke_mode = RESPONSE_STREAM` and CORS restricted to the SPA origin.
- A least-privilege execution role (invoke the AgentCore runtime + write its own logs; no S3, no
  broad Bedrock) and a KMS-encrypted log group.
- A CloudFront OAC, only when `function_url_auth_type = AWS_IAM` (a seam for P8).
- The Function URL published to SSM for the P8 CloudFront wiring.

## The streaming endpoint is a Function URL, not API Gateway

API Gateway HTTP APIs buffer and do not stream. The streaming endpoint is therefore a Lambda
Function URL (`RESPONSE_STREAM`). No API Gateway HTTP API is created here. If non-streaming
request/response endpoints are needed later, add an HTTP API with a Cognito JWT authorizer, and keep
the streaming path on the Function URL.

## Function URL auth: NONE (decision)

`function_url_auth_type` defaults to `NONE`, with the in-function Cognito JWT check as the gate.
Rationale:

- The chat request is a POST with a body. `AWS_IAM` + CloudFront OAC requires the caller to send an
  `x-amz-content-sha256` of the body ("Lambda doesn't support unsigned payloads"), which is hostile
  to a streaming chat POST.
- OAC only proves the request came from our CloudFront distribution; it does not authenticate the
  Cognito user, so the in-function JWT check is needed regardless.

CloudFront still fronts the Function URL (P8). To also block direct-to-origin access, set
`function_url_auth_type = AWS_IAM`: this stack then creates the OAC, and P8 attaches it to the
distribution and grants CloudFront `lambda:InvokeFunctionUrl`. Keep streamed requests body-less/GET
in that mode to avoid the signing caveat.

## Origin contract for P8

CloudFront routes `/api/*` to `bff_function_url` (also in SSM at
`/homebase/<env>/api/bff_function_url`). Requests are POST with a bearer token and JSON body; the
response is `text/event-stream`.

## Deploy note

The BFF uses the AWS SDK v3 client for AgentCore at runtime. If that client is not present in the
Node.js managed runtime at deploy time, vendor it (bundle `node_modules` or attach a layer) before
`apply`. The unit tests do not need it (the agent client is injected).

## Initialize and validate (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values
terraform -chdir=infra/stacks/api init -backend-config=backend.hcl
terraform -chdir=infra/stacks/api plan
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
