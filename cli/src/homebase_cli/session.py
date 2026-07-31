"""Session model. Tenant and user identity are explicit and come from task
configuration, so tenant scoping matches the GUI and the multi-tenant seam stays
intact."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Session:
    session_id: str
    user_id: str
    tenant_id: str
