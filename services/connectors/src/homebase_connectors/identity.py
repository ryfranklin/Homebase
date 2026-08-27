"""Credential resolution from AgentCore Identity / Secrets Manager.

Tokens are namespaced per tenant, matching the memory-actor and JWT tenant
scoping, so the connector layer does not become a single-tenant one-way door. No
tokens, client ids, or workspace/app ids appear in this code: they are fetched at
runtime through the injected identity client.

Two credential shapes are supported. OAuth connectors (Gmail, Slack, Jira, ...)
resolve a per-tenant token via AgentCore Identity (ConnectorCredentials). API-key
connectors (the Tavily-backed web tool) authenticate Homebase to the vendor with a
single, tenant-independent key held in Secrets Manager (ApiKeyCredentials). Both
expose the same get_access_token(tenant_id, connector) interface so the shim stays
credential-agnostic; neither hardcodes a secret.
"""

from __future__ import annotations

import json


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


class ApiKeyCredentials:
    """Resolves a static vendor API key from Secrets Manager for a no-OAuth
    connector (e.g. Tavily). The key authenticates Homebase (not a tenant) to the
    vendor, so tenant_id is accepted for interface parity but does not scope the
    secret; there is no per-tenant token and thus no consent/re-auth flow. The boto3
    secrets client is injected so tests make no AWS call and no key is hardcoded.
    The value is cached for the Lambda's warm lifetime to avoid a fetch per call."""

    def __init__(self, secrets_client, secret_id: str):
        if not secret_id:
            raise ValueError("secret_id is required")
        self._client = secrets_client
        self._secret_id = secret_id
        self._cached = None

    def get_access_token(self, tenant_id: str, connector: str) -> str:
        if self._cached is None:
            self._cached = self._read_secret()
        return self._cached

    def _read_secret(self) -> str:
        resp = self._client.get_secret_value(SecretId=self._secret_id)
        raw = resp.get("SecretString") or ""
        # Accept either a raw key string or a JSON object holding the key under a
        # common field; keep it forgiving so the human can store it either way.
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return raw.strip()
        if isinstance(parsed, dict):
            for field in ("api_key", "apiKey", "TAVILY_API_KEY", "tavily_api_key", "key", "value"):
                if parsed.get(field):
                    return str(parsed[field]).strip()
            # A single-value object: use the lone value.
            if len(parsed) == 1:
                return str(next(iter(parsed.values()))).strip()
            raise ValueError("api-key secret JSON has no recognized key field")
        return str(parsed).strip()
