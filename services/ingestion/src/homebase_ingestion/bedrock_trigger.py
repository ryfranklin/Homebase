"""Real Bedrock Knowledge Base ingestion trigger.

This is the P5 implementation of the P4 ``IngestionTrigger`` contract. It starts
a Bedrock ingestion job after a corpus sync.

Design guarantees the P4 watch items asked for:
- Idempotent: a deterministic ``client_token`` makes a retry of the same sync
  reuse the token, so Bedrock does not start a duplicate job.
- Failures surface: a failed StartIngestionJob raises ``IngestionJobError``
  rather than silently no-op'ing.
"""

from __future__ import annotations

import hashlib

from .trigger import IngestionTriggerRequest, IngestionTriggerResponse


class IngestionJobError(RuntimeError):
    """Raised when starting a Bedrock ingestion job fails. Never swallowed."""


class BedrockIngestionTrigger:
    """Starts a Bedrock KB ingestion job via an injected ``bedrock-agent`` client.

    The client is injected so unit tests pass a fake and make no AWS calls.
    """

    def __init__(self, client):
        self._client = client

    def start(self, request: IngestionTriggerRequest) -> IngestionTriggerResponse:
        kwargs = {
            "knowledgeBaseId": request.knowledge_base_id,
            "dataSourceId": request.data_source_id,
        }
        if request.client_token:
            kwargs["clientToken"] = request.client_token
        if request.description:
            kwargs["description"] = request.description

        try:
            resp = self._client.start_ingestion_job(**kwargs)
        except Exception as exc:  # noqa: BLE001 - surface, do not swallow
            raise IngestionJobError(
                f"failed to start ingestion job for "
                f"kb={request.knowledge_base_id} ds={request.data_source_id}: {exc}"
            ) from exc

        job = resp.get("ingestionJob", {})
        return IngestionTriggerResponse(
            started=True,
            job_id=job.get("ingestionJobId"),
            detail=job.get("status", ""),
        )


def make_client_token(changed_keys) -> str:
    """Deterministic idempotency token derived from the changed object keys.

    Retrying the identical sync produces the same token, so Bedrock treats the
    repeat as the same request. Bedrock requires a token of at least 33
    characters, so the 64-char hex digest is prefixed.
    """
    digest = hashlib.sha256()
    for key in sorted(changed_keys):
        digest.update(key.encode("utf-8"))
        digest.update(b"\n")
    return f"homebase-{digest.hexdigest()}"
