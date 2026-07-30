# services/ingestion/

The ingestion pipeline that loads and updates the Bedrock Knowledge Base (backed by S3 Vectors)
from source documents. It handles chunking, embedding, and sync so the agent can perform hybrid
retrieval.

Bucket names, knowledge base ids, and any credentials come from inputs (environment variables,
Secrets Manager, or SSM), never from literals. Tag every ingested record with tenant and user
identity so the data model stays multi-tenant ready.
