"""Homebase retrieval eval harness.

Scores retrieval quality (hit rate, MRR) with rerank on versus off, so the
rerank lift is visible and rerank has to earn its extra call. Runs offline
against committed synthetic fixtures, and live against a deployed Bedrock
Knowledge Base.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
