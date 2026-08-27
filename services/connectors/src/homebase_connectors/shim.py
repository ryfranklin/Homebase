"""A minimal MCP shim for connectors not natively reachable from the Gateway.

The shim resolves the tenant's token from AgentCore Identity, then routes every
tool call through the write gate. The concrete HTTP call to the connector is an
injected ``api`` callable, so the shim is connector-agnostic and testable, and no
token or endpoint is hardcoded here.
"""

from __future__ import annotations

from .gate import WriteGate
from .lambda_identity import AuthorizationRequiredError


class ConnectorShim:
    def __init__(self, connector, credentials, api, gate=None):
        # `credentials` is any object exposing get_access_token(tenant_id, connector)
        # -> str: ConnectorCredentials (OAuth) or ApiKeyCredentials (no-OAuth vendor
        # key). The shim stays credential-agnostic so a new auth shape needs no change
        # here.
        self._connector = connector
        self._credentials = credentials
        self._api = api
        self._gate = gate or WriteGate()

    def status(self, tenant_id):
        """Connection status for this connector's tenant: 'connected' when a token is
        vaulted, else 'needs_auth' with a consent URL. Runs the same token fetch the
        real tools use (so it is accurate), but makes no vendor call."""
        try:
            self._credentials.get_access_token(tenant_id, self._connector)
            return {"connector": self._connector, "status": "connected"}
        except AuthorizationRequiredError as exc:
            return {"connector": self._connector, "status": "needs_auth", "authorization_url": exc.authorization_url}

    def call(self, tenant_id, tool_name, parameters, *, confirm_token=None, caller=None):
        # Resolve the per-tenant token lazily; a gated write never fetches nor uses
        # it until confirmed, but reads and confirmed writes do.
        def executor(name, params):
            token = self._credentials.get_access_token(tenant_id, self._connector)
            return self._api(self._connector, name, params, token)

        return self._gate.invoke(
            tool_name,
            parameters,
            executor=executor,
            confirm_token=confirm_token,
            caller=caller,
        )
