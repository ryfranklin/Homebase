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
    // Shared secret that CloudFront injects on origin requests. When set, the
    // handler requires the matching X-Origin-Secret header, so a request that
    // reaches the Function URL directly (bypassing CloudFront and the WAF) is
    // refused. The value comes from Secrets Manager via the API stack, never a
    // literal. Optional so local/dev and the unit tests run without it.
    originSharedSecret: env.HOMEBASE_ORIGIN_SHARED_SECRET || null,
  };
}
