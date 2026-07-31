# stacks/web

The GUI delivery tier: a private S3 origin for the SPA bundle and one CloudFront distribution that
also routes `/api/*` to the P7 BFF Function URL, fronted by a WAF web ACL. State lives remotely in
the bootstrap bucket.

## What it creates

- A private S3 bucket for the static SPA bundle: block-public-access on, versioned, deny-non-TLS.
  Served ONLY through CloudFront via Origin Access Control (OAC); there is no public S3 access.
- A CloudFront distribution with two origins:
  - the S3 bucket (default behavior, SPA content, cached), and
  - the BFF Function URL at `/api/*` (no caching, forwards Authorization and the body).
- A WAF web ACL (in us-east-1, as CloudFront requires): AWS managed common rules, known-bad-inputs,
  and a rate-based rule.
- TLS via ACM (cert ARN and domain names are variables; the default CloudFront certificate is used
  when none is given).

## Origin protection (closes the WAF-bypass hole)

Because the Function URL auth type is `NONE`, a caller who knows the Function URL could hit it
directly and skip CloudFront and the WAF. To prevent that, CloudFront injects a shared-secret
`X-Origin-Secret` header on origin requests, and the BFF refuses any request without the matching
value (see `services/bff`). The secret is generated in the api stack and stored in Secrets Manager;
this stack reads it from Secrets Manager for the CloudFront custom header. The value is never a
literal in the repo.

The `AWS_IAM` + CloudFront OAC signing path remains the pre-existing variable-gated seam in the api
stack (`function_url_auth_type`), for the case where you prefer SigV4 origin signing over the shared
header.

## Deploy flow (human runs apply, agents do not)

```bash
cp backend.hcl.example backend.hcl             # edit with bootstrap outputs
cp terraform.tfvars.example terraform.tfvars   # edit with real values
terraform -chdir=infra/stacks/web init -backend-config=backend.hcl
terraform -chdir=infra/stacks/web plan
# after apply: build the SPA (web/) and sync dist/ to the static bucket, then
# invalidate the distribution.
```

Agents may run `fmt`, `validate`, and `plan` only. A human runs `apply`.
