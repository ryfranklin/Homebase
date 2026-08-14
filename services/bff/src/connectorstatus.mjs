// Connector connection status: invoke each connector shim Lambda's status probe (no
// vendor call) and aggregate. Reports whether each connector has a vaulted token for
// the tenant, so the UI can show what is actually connected and offer a Connect link.
// Kept out of bff.mjs so that stays testable; the real Lambda client is built here.

// Connector keys (match services/connectors catalog). gmail/gcal/gdrive share the
// Google provider but each shim is scoped separately, so we probe each.
export const CONNECTOR_KEYS = ["slack", "gmail", "gcal", "gdrive", "jira", "confluence"];

export async function makeConnectorStatus({ region, prefix }) {
  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({ region });

  async function probe(key, tenantId) {
    try {
      const out = await lambda.send(
        new InvokeCommand({
          FunctionName: `${prefix}-connector-${key}`,
          Payload: Buffer.from(JSON.stringify({ name: "status", arguments: { tenant_id: tenantId } })),
        }),
      );
      const body = JSON.parse(Buffer.from(out.Payload ?? Buffer.from("{}")).toString("utf8"));
      return { key, status: body.status ?? "unknown", authorizationUrl: body.authorization_url ?? null };
    } catch {
      return { key, status: "unknown", authorizationUrl: null };
    }
  }

  return {
    async statuses(tenantId) {
      const results = await Promise.all(CONNECTOR_KEYS.map((k) => probe(k, tenantId)));
      const connectors = {};
      for (const r of results) connectors[r.key] = { status: r.status, authorizationUrl: r.authorizationUrl };
      return { connectors };
    },
  };
}
