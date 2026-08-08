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
  };
}
