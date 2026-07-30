"""Retrievers for the eval harness.

FixtureRetriever runs offline against committed synthetic rankings. The live
BedrockKBRetriever queries a deployed Knowledge Base with rerank off and on;
it is documented for post-deploy use and is not exercised by the unit tests.
"""

from __future__ import annotations

from .models import RetrievalResult


class FixtureRetriever:
    """Returns the base and reranked rankings baked into each case. Offline,
    deterministic, no AWS."""

    def retrieve(self, case) -> RetrievalResult:
        return RetrievalResult(base=list(case.offline_base), reranked=list(case.offline_reranked))


class BedrockKBRetriever:
    """Live retriever against a deployed Bedrock Knowledge Base.

    It issues two Retrieve calls per question: one without reranking and one with
    a rerank model, so the scorecard can measure rerank lift on the real corpus.
    S3 Vectors is semantic-only, so search type stays SEMANTIC; rerank is applied
    at query time and is store-independent.

    Not used by the unit tests. Confirm the rerank configuration shape against the
    bedrock-agent-runtime Retrieve API version in your region before relying on
    the live numbers.
    """

    def __init__(self, client, knowledge_base_id, *, rerank_model_arn=None, num_results=10):
        self._client = client
        self._kb_id = knowledge_base_id
        self._rerank_model_arn = rerank_model_arn
        self._num_results = num_results

    def _uris_to_sources(self, response, bucket_prefix_strip=True):
        sources = []
        for result in response.get("retrievalResults", []):
            uri = result.get("location", {}).get("s3Location", {}).get("uri", "")
            if uri.startswith("s3://") and bucket_prefix_strip:
                # s3://bucket/key -> key
                without_scheme = uri[len("s3://"):]
                _, _, key = without_scheme.partition("/")
                sources.append(key)
            else:
                sources.append(uri)
        return sources

    def _retrieve(self, question, with_rerank):
        vector_config = {"numberOfResults": self._num_results, "overrideSearchType": "SEMANTIC"}
        if with_rerank and self._rerank_model_arn:
            vector_config["rerankingConfiguration"] = {
                "type": "BEDROCK_RERANKING_MODEL",
                "bedrockRerankingConfiguration": {
                    "modelConfiguration": {"modelArn": self._rerank_model_arn},
                    "numberOfRerankedResults": self._num_results,
                },
            }
        response = self._client.retrieve(
            knowledgeBaseId=self._kb_id,
            retrievalQuery={"text": question},
            retrievalConfiguration={"vectorSearchConfiguration": vector_config},
        )
        return self._uris_to_sources(response)

    def retrieve(self, case) -> RetrievalResult:
        base = self._retrieve(case.question, with_rerank=False)
        reranked = self._retrieve(case.question, with_rerank=True)
        return RetrievalResult(base=base, reranked=reranked)
