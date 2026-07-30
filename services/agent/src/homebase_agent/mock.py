"""Offline fake Knowledge Base client for mock-mode harness and tests.

Returns canned, SYNTHETIC retrieval results (invented Acme Robotics content, the
same fictional corpus as the eval fixtures). No AWS, no real content.
"""

from __future__ import annotations

# question keyword -> canned retrieval results (Bedrock Retrieve response shape).
_CANNED = {
    "key": [
        ("ops/key-rotation.md", "Rotate the parts-database key every 90 days using the ops runbook.", 0.91),
        ("ops/backups.md", "Backups are encrypted with the same managed key.", 0.55),
    ],
    "warranty": [
        ("products/r200-warranty.md", "The Acme R-200 arm carries a 24-month warranty.", 0.93),
        ("products/r200-overview.md", "The R-200 is a 6-axis arm.", 0.60),
    ],
    "calibration": [
        ("guides/vision-calibration.md", "Calibrate the vision sensor with the checkerboard target.", 0.88),
    ],
}


def _make_results(items, bucket="acme-corpus"):
    results = []
    for source_path, text, score in items:
        results.append(
            {
                "content": {"text": text},
                "location": {"s3Location": {"uri": f"s3://{bucket}/{source_path}"}},
                "score": score,
                "metadata": {"source-path": source_path},
            }
        )
    return results


class FakeKnowledgeBaseClient:
    """Implements just the .retrieve() method the RetrievalTool calls."""

    def __init__(self):
        self.calls = []

    def retrieve(self, knowledgeBaseId, retrievalQuery, retrievalConfiguration):
        self.calls.append(
            {
                "knowledgeBaseId": knowledgeBaseId,
                "retrievalQuery": retrievalQuery,
                "retrievalConfiguration": retrievalConfiguration,
            }
        )
        query = retrievalQuery.get("text", "").lower()
        for keyword, items in _CANNED.items():
            if keyword in query:
                return {"retrievalResults": _make_results(items)}
        # Off-topic: no relevant sources.
        return {"retrievalResults": []}
