"""Credential resolution from AgentCore Identity / Secrets Manager.

Tokens are namespaced per tenant, matching the memory-actor and JWT tenant
scoping, so the connector layer does not become a single-tenant one-way door. No
tokens, client ids, or workspace/app ids appear in this code: they are fetched at
runtime through the injected identity client.
"""

from __future__ import annotations


def tenant_namespaced_key(tenant_id: str, connector: str) -> str:
    """The per-tenant credential key. A tenant can only reach its own connector
    tokens."""
    if not tenant_id or not connector:
        raise ValueError("tenant_id and connector are required")
    return f"{tenant_id}/{connector}"


class ConnectorCredentials:
    """Resolves a connector's OAuth token for a tenant via the injected AgentCore
    Identity / Secrets Manager client. The client is injected so tests make no AWS
    calls and no token is ever hardcoded."""

    def __init__(self, identity_client):
        self._client = identity_client

    def get_access_token(self, tenant_id: str, connector: str) -> str:
        key = tenant_namespaced_key(tenant_id, connector)
        return self._client.get_token(key)
