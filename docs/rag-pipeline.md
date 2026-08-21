# RAG pipeline

How Homebase grounds answers in the vault: the **ingestion** path that turns
git-committed Markdown into a searchable vector index, and the **query** path that
retrieves, reranks, and cites passages for the agent. Every identifier is a
placeholder; the numbers are the current defaults in Terraform and code.

Ground truth: embeddings `amazon.titan-embed-text-v2:0` (1024-dim); vector store
Amazon S3 Vectors (semantic-only); chunking FIXED_SIZE, 512 tokens; rerank
`cohere.rerank-v3-5:0` at query time; over-retrieve 40, top-k 5. Sources:
`infra/stacks/retrieval`, `services/agent/src/homebase_agent/retrieval.py`,
`docs/retrieval.md` (ADR-002).

---

## 1. Two halves

Ingestion writes the index off the request path; query reads it. The S3 Vectors index
is the single shared artifact between them.

```mermaid
flowchart LR
  subgraph Ingest["Ingestion — write path (off request path)"]
    G["homebase-vault (git)"] --> WK["vault-worker"]
    WK --> S3["Corpus S3 (SSE-KMS)"]
    S3 --> KBJ["Bedrock KB ingestion job"]
    KBJ --> IDX[("S3 Vectors index<br/>Titan v2 · 1024-dim")]
  end
  subgraph Query["Query — read path (per request)"]
    AG["Agent tool-use loop"] --> RT["RetrievalTool"]
    RT --> RET["Bedrock Retrieve + Rerank"]
    RET --> IDX
    RET --> P["top-k passages + citations"]
    P --> AG
  end
```

---

## 2. Ingestion: git to chunk to embed to index

A commit to the vault is mirrored (only the diff) to the corpus bucket, which triggers
a Knowledge Base ingestion job. The KB chunks each Markdown note, embeds each chunk,
and writes the vectors plus chunk text and metadata into the S3 Vectors index.
`personal/` is excluded everywhere, so private notes are never embedded.

```mermaid
flowchart TD
  C["git commit on homebase-vault<br/>(Markdown only; personal/ excluded)"] --> W["vault-worker<br/>mirror ONLY the changed files"]
  W --> S3["Corpus S3 object (SSE-KMS)"]
  W --> J["StartIngestionJob"]
  J --> SCAN["KB scans the data source"]
  SCAN --> CHUNK["FIXED_SIZE chunking<br/>max_tokens = 512, overlap = %"]
  CHUNK --> EMB["Titan Embeddings v2<br/>amazon.titan-embed-text-v2:0 to 1024-dim vector"]
  EMB --> PUT["s3vectors:PutVectors"]
  PUT --> IDX[("S3 Vectors index<br/>vector + AMAZON_BEDROCK_TEXT + _METADATA")]
  W -. "delete removed / no-op when git HEAD unchanged" .-> S3
```

---

## 3. Query time: two-rung retrieval (semantic over-retrieve, then rerank)

The agent's `search_knowledge_base` tool over-retrieves a wide semantic candidate set
from S3 Vectors, then reranks it with Cohere to pull the best passages to the top. S3
Vectors is semantic-only, so the search type is always `SEMANTIC`; rerank is a
query-time step, independent of the store.

```mermaid
sequenceDiagram
  autonumber
  participant AG as Agent (tool loop)
  participant RT as RetrievalTool
  participant KB as Bedrock KB Retrieve
  participant V as S3 Vectors index
  participant RR as Cohere rerank v3.5

  AG->>RT: search_knowledge_base(query)
  Note over RT: rung 1 — wide dense candidate set
  RT->>KB: Retrieve(numberOfResults=40,<br/>overrideSearchType=SEMANTIC, optional filter)
  KB->>V: kNN over 1024-dim vectors
  V-->>KB: 40 candidate chunks (+ score)
  Note over KB,RR: rung 2 — rerank (when a rerank model is configured)
  KB->>RR: rerank 40 candidates<br/>numberOfRerankedResults = min(40, top_k*4)
  RR-->>KB: candidates reordered by relevance
  KB-->>RT: results
  RT-->>AG: top_k = 5 passages (sourcePath, score)
  AG->>AG: ground the answer + cite sources, stream via SSE
```

Optional metadata narrowing (before rung 1): a `tag` filter and an `updated_after`
recency filter are ANDed into the vector search when supplied.

```mermaid
flowchart LR
  Q["retrieve(query, tag?, updated_after?)"] --> F{"build_filter"}
  F -->|"tag set"| T["equals TAG_METADATA_KEY"]
  F -->|"updated_after set"| R["greaterThan RECENCY_METADATA_KEY"]
  T --> AND["AND -> vectorSearchConfiguration.filter"]
  R --> AND
  F -->|"neither"| NONE["no filter (whole index)"]
```

---

## 4. The rerank IAM boundary

Rerank runs under the **KB service role**, not the caller's role: Bedrock assumes a
`BedrockReranking-*` role to evaluate against a system rerank resource. The KB role
therefore needs both `bedrock:Rerank` (resource `*`, a system resource) and a scoped
`bedrock:InvokeModel` on the rerank model. Missing either turns Retrieve-with-rerank
into a 403 — and the ADR-002 eval fails with it.

```mermaid
flowchart LR
  CALLER["Agent / eval caller"] -->|"Retrieve w/ rerankingConfiguration"| KB["KB service role"]
  KB --> ASSUME["assumes BedrockReranking-*"]
  ASSUME -->|"bedrock:Rerank (resource *)"| SYS["system rerank resource"]
  ASSUME -->|"bedrock:InvokeModel (scoped)"| MODEL["cohere.rerank-v3-5:0"]
  KB -. "missing either grant -> 403 on Retrieve-with-rerank" .-> MODEL
```

---

## 5. ADR-002: the gated hybrid seam

S3 Vectors supports semantic search only; a `HYBRID` override silently degrades to
semantic on it. Hybrid (dense + keyword) is a marked, variable-gated seam to Amazon
OpenSearch Serverless, taken only if the evidence demands it. Because the S3 Vectors
storage arguments are ForceNew, switching rebuilds the store.

```mermaid
stateDiagram-v2
  [*] --> Semantic
  state "S3 Vectors — SEMANTIC + query-time rerank (default)" as Semantic
  state "OpenSearch Serverless — HYBRID + rerank + rich filters" as Hybrid
  Semantic --> Hybrid: eval shows a keyword miss rerank cannot fix
  Hybrid --> Semantic: not currently triggered (ADR-002)
  Semantic --> Semantic: HYBRID override degrades to semantic here
  note right of Hybrid
    ForceNew seam: switching rebuilds
    the vector store; gated by a variable
  end note
```

---

## 6. Evidence: the eval-driven decision loop

Whether semantic + rerank is good enough is decided on data, not opinion. The eval
harness scores hit rate and MRR with rerank off vs on; a CI regression gate guards the
retrieval code on synthetic fixtures, while a live eval on the real corpus decides the
ADR-002 question.

```mermaid
flowchart LR
  CORP[("real corpus in S3 Vectors")] --> EVAL["eval harness (eval/)"]
  EVAL --> M["hit_rate@k and MRR<br/>rerank OFF vs ON"]
  M --> CI["CI regression gate<br/>(synthetic fixtures)"]
  M --> LIVE["live eval (real corpus)"]
  LIVE --> DEC{"clears the 0.85 target?"}
  DEC -->|"yes -> STAY"| SV["S3 Vectors semantic + rerank<br/>reranked hit_rate@5 = 1.0 · MRR 0.842 -> 0.977"]
  DEC -->|"no -> SWITCH"| OS["trigger the OpenSearch seam"]
```
