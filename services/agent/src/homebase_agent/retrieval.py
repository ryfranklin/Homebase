"""Retrieval tool: cited passages from the P5 Knowledge Base.

This is where the ADR-002 compensation ladder lives, because S3 Vectors is
semantic-only (no hybrid). To carry exact-term and scoped queries on a semantic
store, the tool:

  rung 1: over-retrieves a wide dense candidate set (over_retrieve),
  rung 2: reranks with Bedrock Rerank to pull the best candidates to the top,
  filters: exposes tag / folder / recency as parameters.

S3 Vectors supports only a subset of metadata filter operators (equals, in,
range, boolean combinations); it does NOT support startsWith or stringContains.
So server-side filters use only supported operators, and the folder filter (a
prefix match) is applied client-side. On the OpenSearch Serverless fallback
(ADR-002) these could all move server-side.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Metadata keys the ingestion tool (P4) writes and the filters read.
TAG_METADATA_KEY = "fm-tags"
RECENCY_METADATA_KEY = "fm-updated"


@dataclass(frozen=True)
class Passage:
    text: str
    source_path: str
    score: float | None = None
    metadata: dict = field(default_factory=dict)
    location_uri: str = ""


def build_filter(tag=None, updated_after=None, *, tag_key=TAG_METADATA_KEY, recency_key=RECENCY_METADATA_KEY):
    """Build a Bedrock retrieval filter using only S3-Vectors-supported operators.

    Returns None when there is nothing to filter. Folder filtering is NOT here:
    it needs a prefix (startsWith), which S3 Vectors does not support, so it is
    applied client-side in retrieve().
    """
    clauses = []
    if tag:
        clauses.append({"equals": {"key": tag_key, "value": tag}})
    if updated_after:
        clauses.append({"greaterThanOrEquals": {"key": recency_key, "value": updated_after}})

    if not clauses:
        return None
    if len(clauses) == 1:
        return clauses[0]
    return {"andAll": clauses}


def _source_from_uri(uri: str) -> str:
    if uri.startswith("s3://"):
        _, _, key = uri[len("s3://"):].partition("/")
        return key
    return uri


def _to_passage(result: dict) -> Passage:
    uri = result.get("location", {}).get("s3Location", {}).get("uri", "")
    return Passage(
        text=result.get("content", {}).get("text", ""),
        source_path=_source_from_uri(uri),
        score=result.get("score"),
        metadata=result.get("metadata", {}) or {},
        location_uri=uri,
    )


class RetrievalTool:
    """Queries a Bedrock Knowledge Base and returns cited passages.

    The bedrock-agent-runtime client is injected so tests pass a fake and make no
    AWS calls.
    """

    def __init__(self, client, knowledge_base_id, *, rerank_model_arn=None, num_results_default=5):
        self._client = client
        self._kb_id = knowledge_base_id
        self._rerank_model_arn = rerank_model_arn
        self._num_results_default = num_results_default

    def retrieve(
        self,
        query,
        *,
        top_k=None,
        over_retrieve=40,
        rerank=True,
        tag=None,
        folder=None,
        updated_after=None,
    ):
        top_k = top_k or self._num_results_default

        vector_config = {
            "numberOfResults": over_retrieve,  # rung 1: wide dense candidate set
            "overrideSearchType": "SEMANTIC",  # S3 Vectors is semantic-only
        }

        filter_expr = build_filter(tag, updated_after)
        if filter_expr:
            vector_config["filter"] = filter_expr

        if rerank and self._rerank_model_arn:
            # rung 2: rerank the wide candidate set.
            vector_config["rerankingConfiguration"] = {
                "type": "BEDROCK_RERANKING_MODEL",
                "bedrockRerankingConfiguration": {
                    "modelConfiguration": {"modelArn": self._rerank_model_arn},
                    "numberOfRerankedResults": min(over_retrieve, max(top_k * 4, top_k)),
                },
            }

        response = self._client.retrieve(
            knowledgeBaseId=self._kb_id,
            retrievalQuery={"text": query},
            retrievalConfiguration={"vectorSearchConfiguration": vector_config},
        )

        passages = [_to_passage(r) for r in response.get("retrievalResults", [])]

        if folder:
            # Client-side prefix filter (startsWith is unsupported on S3 Vectors).
            prefix = folder if folder.endswith("/") else folder + "/"
            passages = [p for p in passages if p.source_path.startswith(prefix)]

        return passages[:top_k]
