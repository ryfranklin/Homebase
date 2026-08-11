"""AgentCore Memory wrappers.

Short-term memory is the session event stream; long-term memory is recalled via
memory records. The bedrock-agentcore client is injected. NullMemory is the
default so the agent runs with no memory wired (and the tests need no AWS).

Tenant identity is carried into the actor id (see Session.memory_actor_id), so
memory never crosses tenants.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol

# AgentCore Memory's conversational role is an uppercase enum (USER/ASSISTANT/TOOL).
_ROLE_MAP = {"user": "USER", "assistant": "ASSISTANT", "tool": "TOOL"}


class Memory(Protocol):
    def record_turn(self, session, role: str, text: str) -> None: ...
    def recall(self, session, query: str, *, top_k: int = 5) -> list: ...


class NullMemory:
    """No-op memory. Default until a memory id is configured."""

    def record_turn(self, session, role, text) -> None:
        return None

    def recall(self, session, query, *, top_k=5) -> list:
        return []


class AgentCoreMemory:
    """AgentCore Memory backed by an injected bedrock-agentcore client."""

    def __init__(self, client, memory_id):
        self._client = client
        self._memory_id = memory_id

    def record_turn(self, session, role, text) -> None:
        # eventTimestamp is required; role must be the uppercase enum value.
        self._client.create_event(
            memoryId=self._memory_id,
            actorId=session.memory_actor_id(),
            sessionId=session.session_id,
            eventTimestamp=datetime.now(timezone.utc),
            payload=[
                {"conversational": {"role": _ROLE_MAP.get(role, "OTHER"), "content": {"text": text}}}
            ],
        )

    def recall(self, session, query, *, top_k=5) -> list:
        response = self._client.retrieve_memory_records(
            memoryId=self._memory_id,
            namespace=session.memory_actor_id(),
            searchCriteria={"searchQuery": query, "topK": top_k},
        )
        records = response.get("memoryRecordSummaries", [])
        return [r.get("content", {}).get("text", "") for r in records]
