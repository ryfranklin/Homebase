// Runtime configuration, all sourced from environment variables that the API
// Terraform stack populates from SSM (P3 and P6 outputs). No literals here.

export function loadConfig(env = process.env) {
  const required = ["HOMEBASE_ISSUER", "HOMEBASE_AUDIENCE", "HOMEBASE_AGENT_RUNTIME_ARN", "HOMEBASE_ALLOWED_ORIGIN"];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`missing required env: ${missing.join(", ")}`);
  }
  return {
    issuer: env.HOMEBASE_ISSUER,
    audience: env.HOMEBASE_AUDIENCE,
    agentRuntimeArn: env.HOMEBASE_AGENT_RUNTIME_ARN,
    allowedOrigin: env.HOMEBASE_ALLOWED_ORIGIN,
    region: env.AWS_REGION,
    // The single-tenant seed's default tenant, used when the verified token carries
    // no custom:tenant_id claim (e.g. federated sign-ins that were auto-provisioned
    // without the attribute). This mirrors the connector shim's HOMEBASE_DEFAULT_TENANT
    // so the BFF, the agent, and the connector token vault all agree on the tenant.
    // Left null (claim required) when unset, preserving multi-tenant safety.
    defaultTenant: env.HOMEBASE_DEFAULT_TENANT || null,
    // Shared secret that CloudFront injects on origin requests. When set, the
    // handler requires the matching X-Origin-Secret header, so a request that
    // reaches the Function URL directly (bypassing CloudFront and the WAF) is
    // refused. Optional so local/dev and the unit tests run without it.
    originSharedSecret: env.HOMEBASE_ORIGIN_SHARED_SECRET || null,
    // ARN of the rotating origin secret in Secrets Manager. When set, the handler
    // loads the current (and pending, during rotation) values at runtime, so the
    // secret can be rotated without a redeploy.
    originSecretArn: env.HOMEBASE_ORIGIN_SECRET_ARN || null,
    // Vault workspace: the S3 Markdown corpus is the editable vault. When the
    // bucket is set, the BFF exposes /api/vault/*; when the KB id + data source id
    // are also set, saving a note best-effort re-grounds it for the agent. All
    // optional so the chat-only deployment and the unit tests run without them.
    corpusBucket: env.HOMEBASE_CORPUS_BUCKET || null,
    kbId: env.HOMEBASE_KB_ID || null,
    kbDataSourceId: env.HOMEBASE_KB_DATA_SOURCE_ID || null,
    // Vault worker (git source of truth). Writes go to the worker's internal API;
    // reads stay on the S3 mirror. Both optional so chat-only and tests run without.
    // The shared secret is read from Secrets Manager at cold start (by ARN), like
    // the origin secret; workerSecret is a direct value for local/tests.
    workerUrl: env.HOMEBASE_VAULT_WORKER_URL || null,
    workerSecret: env.HOMEBASE_WORKER_SHARED_SECRET || null,
    workerSecretArn: env.HOMEBASE_WORKER_SECRET_ARN || null,
    // Prefix of the connector shim Lambdas (<prefix>-connector-<key>), used to probe
    // connection status. When set, /api/connectors/status is enabled.
    connectorPrefix: env.HOMEBASE_CONNECTOR_PREFIX || null,
    // Confluence site base URL (e.g. https://your-org.atlassian.net), used to build
    // absolute page links for Flight Planner sources. Optional; links degrade to the
    // relative path when unset.
    confluenceSiteUrl: env.HOMEBASE_CONFLUENCE_SITE_URL || null,
    // Mission Control (the execution engine). When the base URL is set, the BFF
    // exposes /api/missions/* to launch runs from flight-plan units, stream live
    // telemetry, and drive the go/no-go gate. The bearer token authorizes mutations;
    // it is a direct value for local/tests or read once from Secrets Manager by ARN,
    // like the vault worker secret. All optional so chat-only and tests run without.
    missionUrl: env.HOMEBASE_MISSION_CONTROL_URL || null,
    missionToken: env.HOMEBASE_MISSION_CONTROL_TOKEN || null,
    missionTokenArn: env.HOMEBASE_MISSION_CONTROL_TOKEN_ARN || null,
  };
}
