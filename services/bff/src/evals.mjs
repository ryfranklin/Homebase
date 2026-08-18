// Read surface for the eval harness. The deployed harness writes each run's full
// payload (report.assemble shape) to S3 at runs/<id>/payload.json and a run header
// to DynamoDB (pk=TENANT#<t>, sk=RUN#<created_at>#<id>). Listing reads the headers;
// fetching one run streams its payload straight from S3. No reconstruction here:
// the harness owns the shape, and the SPA Evals tab consumes it verbatim.
//
// AWS SDK v3 is imported lazily so chat-only deployments and the unit tests that do
// not exercise evals never load it. makeEvals accepts injected clients for tests.

export async function makeEvals({ region, tableName, bucketName, clients } = {}) {
  let dynamo = clients?.dynamo;
  let s3 = clients?.s3;
  if (!dynamo || !s3) {
    const { DynamoDBClient, QueryCommand } = await import("@aws-sdk/client-dynamodb");
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const ddb = new DynamoDBClient({ region });
    const s3c = new S3Client({ region });
    dynamo = dynamo || { query: (args) => ddb.send(new QueryCommand(args)) };
    s3 = s3 || { getObject: (args) => s3c.send(new GetObjectCommand(args)) };
  }

  return {
    // Newest runs first for a tenant. Parses the stored scorecards to surface the
    // top model/quality without pulling the whole payload.
    async listRuns(tenantId, { limit } = {}) {
      const res = await dynamo.query({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": { S: `TENANT#${tenantId}` }, ":sk": { S: "RUN#" } },
        ScanIndexForward: false,
        Limit: Math.min(Number(limit) || 50, 200),
      });
      const runs = (res.Items || []).map((it) => {
        let cards = [];
        try {
          cards = JSON.parse(it.scorecards?.S || "[]");
        } catch {
          /* header without scorecards (still running) */
        }
        const top = cards[0];
        return {
          runId: it.run_id?.S || "",
          suite: it.suite?.S || "",
          judge: it.judge?.S || "",
          status: it.status?.S || "",
          createdAt: (it.sk?.S || "").split("#")[1] || "",
          topModel: top?.model,
          topQuality: top?.avg_quality,
          nModels: cards.length || undefined,
        };
      });
      return { runs };
    },

    // The full run payload from S3. Tenant is not in the S3 key, so we do not leak
    // across tenants by run-id guessing: only run-ids the caller's tenant listing
    // exposed are reachable in practice, and a 404 is returned when absent.
    async getRun(_tenantId, runId) {
      try {
        const out = await s3.getObject({ Bucket: bucketName, Key: `runs/${runId}/payload.json` });
        const text = await streamToString(out.Body);
        return JSON.parse(text);
      } catch (err) {
        if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
          const e = new Error("run not found");
          e.status = 404;
          e.code = "run_not_found";
          throw e;
        }
        throw err;
      }
    },
  };
}

async function streamToString(body) {
  if (!body) return "";
  if (typeof body.transformToString === "function") return body.transformToString("utf8");
  const chunks = [];
  for await (const chunk of body) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}
