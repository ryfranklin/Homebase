# services/bff/

The backend for frontend (BFF), deployed as API Gateway plus Lambda. It is the only backend the
React SPA talks to. It validates Cognito tokens (including Google federated identities), enforces
authorization, and forwards requests to the agent runtime.

No client IDs, pool IDs, or endpoints are hardcoded: they come from environment variables and
resolved Terraform outputs.
