"""A minimal MCP shim for connectors not natively reachable from the Gateway.

The shim resolves the tenant's token from AgentCore Identity, then routes every
tool call through the write gate. The concrete HTTP call to the connector is an
injected ``api`` callable, so the shim is connector-agnostic and testable, and no
token or endpoint is hardcoded here.
"""

from __future__ import annotations

from .gate import WriteGate
from .identity import ConnectorCredentials


class ConnectorShim:
    def __init__(self, connector, credentials: ConnectorCredentials, api, gate=None):
        self._connector = connector
        self._credentials = credentials
        self._api = api
        self._gate = gate or WriteGate()

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
