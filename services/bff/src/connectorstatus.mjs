// Connector connection status: invoke each connector shim Lambda's status probe (no
// vendor call) and aggregate. Reports whether each connector has a vaulted token for
// the tenant, so the UI can show what is actually connected and offer a Connect link.
// Kept out of bff.mjs so that stays testable; the real Lambda client is built here.

// UI-facing connector key -> deployed shim Lambda suffix. They match except Jira,
// whose shim is deployed under the Atlassian provider name (homebase-*-connector-atlassian).
// gmail/gcal/gdrive share the Google provider but each shim is scoped separately, so we
// probe each. The UI keys these by `key` (see web/src/chat/sources.ts), so the returned
// map must use `key`, not the Lambda suffix.
export const CONNECTOR_FUNCTIONS = [
  { key: "slack", fn: "slack" },
  { key: "gmail", fn: "gmail" },
  { key: "gcal", fn: "gcal" },
  { key: "gdrive", fn: "gdrive" },
  { key: "jira", fn: "atlassian" },
  { key: "confluence", fn: "confluence" },
];

export async function makeConnectorStatus({ region, prefix }) {
  const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({ region });

  async function probe({ key, fn }, tenantId) {
    try {
      const out = await lambda.send(
        new InvokeCommand({
          FunctionName: `${prefix}-connector-${fn}`,
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
      const results = await Promise.all(CONNECTOR_FUNCTIONS.map((c) => probe(c, tenantId)));
      const connectors = {};
      for (const r of results) connectors[r.key] = { status: r.status, authorizationUrl: r.authorizationUrl };
      return { connectors };
    },
  };
}
