// Real S3-backed store + Bedrock Knowledge Base reingest for the vault, built from
// the runtime AWS SDK (present in nodejs20.x). Kept out of vault.mjs so that module
// stays pure and unit-testable with a fake store.

export async function makeVaultDeps({ region, bucket, kbId, dataSourceId }) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const s3 = new S3Client({ region });

  const store = {
    async listKeys() {
      const keys = [];
      let ContinuationToken;
      do {
        const out = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken }));
        for (const obj of out.Contents || []) {
          if (/\.(md|markdown)$/i.test(obj.Key) && !/\.metadata\.json$/i.test(obj.Key)) keys.push(obj.Key);
        }
        ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return keys;
    },
    async getObject(key) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return { content: await out.Body.transformToString("utf8") };
    },
    async putObject(key, body, contentType, metadata) {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata || {} }),
      );
    },
    async deleteObject(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };

  let reingest = async () => {};
  if (kbId && dataSourceId) {
    const { BedrockAgentClient, StartIngestionJobCommand } = await import("@aws-sdk/client-bedrock-agent");
    const ba = new BedrockAgentClient({ region });
    reingest = async () => {
      try {
        await ba.send(new StartIngestionJobCommand({ knowledgeBaseId: kbId, dataSourceId }));
      } catch (err) {
        // Only one ingestion job runs at a time; a ConflictException just means a
        // sync is already in flight. The write is durable in S3, so the current or
        // next sync picks it up. Never fail the user's save over grounding lag.
        if (err?.name !== "ConflictException") {
          console.error(JSON.stringify({ event: "reingest_error", error: err?.name || "error" }));
        }
      }
    };
  }

  return { store, reingest };
}
