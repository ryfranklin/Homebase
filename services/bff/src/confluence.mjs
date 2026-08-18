// Confluence search for the Flight Planner: pull real design pages to select as plan
// sources. Invokes the confluence connector shim (which resolves the tenant's vaulted
// Atlassian token) and maps the raw Atlassian CQL response into a compact result the
// SPA can list and snapshot. Kept out of bff.mjs so that stays testable.

// Build a bounded CQL from free text. The new Confluence search endpoint rejects
// unbounded queries, so we always constrain to a text match, newest first.
export function toCql(query) {
  const q = String(query || "").replace(/["\\]/g, "").trim();
  return q ? `text ~ "${q}" order by lastmodified desc` : `type = page order by lastmodified desc`;
}

// Map the Atlassian CQL response (shape varies by API version) into { id, title,
// url, excerpt }, tolerant of missing fields.
export function mapConfluenceResults(body, siteUrl = "") {
  const results = Array.isArray(body?.results) ? body.results : [];
  // Site URL is optional (config.confluenceSiteUrl is null when unset); links then
  // degrade to the relative path instead of crashing on null.replace().
  const base = (siteUrl || "").replace(/\/$/, "");
  return results
    .map((r) => {
      const content = r.content ?? r;
      const id = content.id ?? r.id ?? null;
      const title = content.title ?? r.title ?? null;
      const webui = content._links?.webui ?? r._links?.webui ?? r.url ?? "";
      const url = webui && base && webui.startsWith("/") ? `${base}/wiki${webui}` : webui || null;
      const excerpt = (r.excerpt ?? "").replace(/<[^>]+>/g, "").trim();
      return { id, title, url, excerpt };
    })
    .filter((r) => r.id || r.title);
}

export function makeConfluence({ region, prefix, siteUrl = "" }) {
  let lambdaPromise = null;
  async function client() {
    if (!lambdaPromise) {
      lambdaPromise = import("@aws-sdk/client-lambda").then(({ LambdaClient, InvokeCommand }) => ({
        lambda: new LambdaClient({ region }),
        InvokeCommand,
      }));
    }
    return lambdaPromise;
  }
  return {
    async search(tenantId, query, limit = 15) {
      const { lambda, InvokeCommand } = await client();
      const out = await lambda.send(
        new InvokeCommand({
          FunctionName: `${prefix}-connector-confluence`,
          Payload: Buffer.from(JSON.stringify({ name: "confluence_search", arguments: { cql: toCql(query), limit, tenant_id: tenantId } })),
        }),
      );
      const body = JSON.parse(Buffer.from(out.Payload ?? Buffer.from("{}")).toString("utf8"));
      // Surface a consent requirement so the SPA can send the user to link Atlassian.
      if (body?.requires_authorization) return { requires_authorization: true, authorization_url: body.authorization_url ?? null };
      return { results: mapConfluenceResults(body, siteUrl) };
    },
  };
}
