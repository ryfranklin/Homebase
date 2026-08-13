# cicd stack

Provisions the AWS identity that GitHub Actions assumes to publish the web SPA.
It is **content-deploy only**: the role can sync objects into the web bucket and
invalidate the web CloudFront distribution, nothing else. It cannot run
`terraform apply`, touch IAM, or deploy the agent image. Those remain human
actions (see `scripts/deploy-agent.sh` and `docs/RUNBOOK.md`).

## What it creates

- A GitHub Actions OIDC provider (`token.actions.githubusercontent.com`), unless
  you pass an existing one via `github_oidc_provider_arn` (only one per account
  is allowed).
- An IAM role (`<project>-<env>-web-deploy`) whose trust policy allows **only**
  the `main` branch of `github_repo` to assume it over OIDC (no long-lived keys).
- A least-privilege inline policy: `s3:ListBucket` on the web bucket,
  `s3:{Get,Put,Delete}Object` on its objects, and `cloudfront:CreateInvalidation`
  / `GetInvalidation` on the web distribution (read from SSM).

The web bucket is SSE-S3 (AES256), so no KMS grant is required.

## Apply (human only)

Agents never apply. A human runs:

```sh
cp backend.hcl.example backend.hcl            # fill from bootstrap outputs
cp terraform.tfvars.example terraform.tfvars  # fill in real values
terraform -chdir=infra/stacks/cicd init -backend-config=backend.hcl
terraform -chdir=infra/stacks/cicd plan
terraform -chdir=infra/stacks/cicd apply
```

`terraform output web_deploy_role_arn` prints the ARN to wire into GitHub.

## Wire up GitHub Actions

The `deploy-web` job in `.github/workflows/ci.yml` stays skipped (green) until
both `AWS_DEPLOY_ROLE_ARN` and `WEB_BUCKET` are set. Add all of the following as
repo **Secrets** under `Settings -> Secrets and variables -> Actions -> Secrets`:

- `AWS_DEPLOY_ROLE_ARN` = `terraform output -raw web_deploy_role_arn`
- `AWS_REGION`
- `WEB_BUCKET` (the SPA bucket name)
- `CLOUDFRONT_DISTRIBUTION_ID`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_COGNITO_HOSTED_UI_DOMAIN`
- `VITE_COGNITO_SCOPES`
- `VITE_REDIRECT_URI`
- `VITE_LOGOUT_URI`
- `VITE_API_BASE_URL`

Only `AWS_DEPLOY_ROLE_ARN` is truly sensitive. The rest are public client
identifiers and resource names (they ship in the SPA bundle / appear in DNS), but
keeping them as Secrets masks them in the public Actions logs and keeps them out
of the committed workflow. Once the two required Secrets exist, every push to
`main` that passes the checks builds the SPA and deploys it.
