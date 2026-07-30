"""Session model.

User and tenant identity are explicit here. Homebase is the single-tenant seed
of a future multi-tenant platform, so tenant_id is threaded through the agent
plane from the start (it matches the tenant_id claim on the Cognito user pool).
The agent must never become a single-tenant one-way door.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Session:
    session_id: str
    user_id: str
    tenant_id: str
    attributes: dict = field(default_factory=dict)

    def memory_actor_id(self) -> str:
        """Actor id used for AgentCore Memory, namespaced by tenant so memory
        never leaks across tenants."""
        return f"{self.tenant_id}/{self.user_id}"
