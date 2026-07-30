"""Trigger contract for starting a Bedrock Knowledge Base ingestion job.

This is an INTERFACE only. P4 defines the contract; P5 wires the real Bedrock
implementation. Nothing here calls Bedrock or any AWS service.

Contract
--------
After a successful sync that changed the corpus (uploaded or pruned at least one
object), the caller builds an ``IngestionTriggerRequest`` and calls
``IngestionTrigger.start``. The request carries the knowledge base id and data
source id (both non-secret identifiers, resolved from SSM at runtime), the count
of changed objects, and an idempotency ``client_token`` so a retry does not start
a duplicate job. The implementation returns an ``IngestionTriggerResponse`` with
whether a job was started and its job id.

Until P5, the default implementation is ``NullIngestionTrigger``, which records
the request and starts nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass(frozen=True)
class IngestionTriggerRequest:
    knowledge_base_id: str
    data_source_id: str
    changed_count: int = 0
    description: Optional[str] = None
    client_token: Optional[str] = None


@dataclass(frozen=True)
class IngestionTriggerResponse:
    started: bool
    job_id: Optional[str] = None
    detail: str = ""


class IngestionTrigger(Protocol):
    """Something that can start a knowledge base ingestion job."""

    def start(self, request: IngestionTriggerRequest) -> IngestionTriggerResponse:
        ...


class NullIngestionTrigger:
    """Default trigger until P5. Records requests; starts nothing; calls no AWS.

    The real Bedrock-backed trigger lands in P5 and implements the same
    ``IngestionTrigger`` protocol, so callers do not change.
    """

    def __init__(self) -> None:
        self.requests: list = []

    def start(self, request: IngestionTriggerRequest) -> IngestionTriggerResponse:
        self.requests.append(request)
        return IngestionTriggerResponse(
            started=False,
            job_id=None,
            detail="null trigger: Bedrock ingestion not wired yet (P5)",
        )


def should_trigger(sync_result) -> bool:
    """The corpus changed if anything was uploaded or pruned."""
    return bool(getattr(sync_result, "uploaded", []) or getattr(sync_result, "pruned", []))
