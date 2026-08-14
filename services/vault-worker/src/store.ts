// Real S3 + Bedrock Knowledge Base store for the mirror. Uses the AWS SDK provided
// in the container image (added as a dependency). Kept out of mirror.ts so that
// module stays pure and unit-testable with a fake store.

import type { MirrorStore } from "./mirror.ts";

export async function makeStore(opts: {
  region: string | undefined;
  bucket: string;
  kbId: string | null;
  kbDataSourceId: string | null;
}): Promise<MirrorStore> {
  // @ts-ignore optional runtime dependency, present in the container image
  const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: opts.region });

  let reingest = async (): Promise<void> => {};
  if (opts.kbId && opts.kbDataSourceId) {
    const knowledgeBaseId = opts.kbId;
    const dataSourceId = opts.kbDataSourceId;
    // @ts-ignore optional runtime dependency, present in the container image
    const { BedrockAgentClient, StartIngestionJobCommand } = await import("@aws-sdk/client-bedrock-agent");
    const ba = new BedrockAgentClient({ region: opts.region });
    reingest = async () => {
      try {
        await ba.send(new StartIngestionJobCommand({ knowledgeBaseId, dataSourceId }));
      } catch (err) {
        // One ingestion job runs at a time; a ConflictException just means a sync is
        // already in flight. The bytes are durable in S3, so the next sync covers it.
        if ((err as { name?: string })?.name !== "ConflictException") {
          console.error(JSON.stringify({ event: "reingest_error", error: (err as { name?: string })?.name || "error" }));
        }
      }
    };
  }

  return {
    async listKeys(): Promise<string[]> {
      const keys: string[] = [];
      let ContinuationToken: string | undefined;
      do {
        const out = await s3.send(new ListObjectsV2Command({ Bucket: opts.bucket, ContinuationToken }));
        for (const obj of out.Contents ?? []) if (obj.Key) keys.push(obj.Key);
        ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return keys;
    },
    async putObject(key: string, body: string) {
      await s3.send(new PutObjectCommand({ Bucket: opts.bucket, Key: key, Body: body, ContentType: "text/markdown" }));
    },
    async deleteObject(key: string) {
      await s3.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }));
    },
    reingest,
  };
}
