"""Lambda entrypoint for a connector shim, invoked by the AgentCore Gateway.

One Lambda per connector (homebase-<env>-connector-<key>). The Gateway invokes it
with an MCP tool call; this handler normalizes the event, enforces the write gate
(via ConnectorShim), and returns the tool result or a confirmation contract.

The safety-critical path (a write is gated, a token is never fetched for an
unconfirmed write) is fully covered by offline tests. The live token fetch and the
vendor HTTP calls are injected (AgentCoreIdentityClient, make_api) so the handler
is testable without AWS or network.

Assumed Gateway->Lambda event: the tool name and its arguments, plus the caller's
verified identity (the Cognito tenant claim). Shapes vary, so extraction is
defensive; `tenant_id` falls back to HOMEBASE_DEFAULT_TENANT for the single-tenant
seed but is preferred from the verified caller context.
"""

from __future__ import annotations

import os

from .api import make_api
from .catalog import TOOLS
from .confirmation import ConfirmationContract
from .gate import UnknownToolError
from .identity import ConnectorCredentials
from .lambda_identity import AgentCoreIdentityClient
from .shim import ConnectorShim

# Map the Gateway tool name (underscore form, e.g. slack_read_messages) to the
# catalog tool name (dot form, e.g. slack.read_messages). Built from the catalog
# so it always matches, and accepts the dot form too.
_UNDERSCORE_TO_DOT = {name.replace(".", "_"): name for name in TOOLS}


def _catalog_name(raw_name):
    if raw_name in TOOLS:
        return raw_name
    return _UNDERSCORE_TO_DOT.get(raw_name, raw_name)


def _first(d, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return d[k]
    return default


def _extract(event, context):
    event = event or {}
    tool_name = _first(event, "name", "tool", "toolName", "tool_name", default="")
    params = _first(event, "arguments", "input", "parameters", "params", default={}) or {}
    if not isinstance(params, dict):
        params = {}

    # A confirmation token may arrive as a tool arg or a top-level field.
    confirm_token = params.pop("confirmation_token", None) or _first(event, "confirmation_token")

    # Verified caller identity (the Gateway passes the JWT claims). Prefer the
    # tenant claim from the caller context; fall back to the seed default.
    ctx = _first(event, "context", "identity", "requestContext", default={}) or {}
    claims = _first(ctx, "claims", "jwt", default={}) or {}
    tenant_id = (
        _first(params, "tenant_id")
        or _first(claims, "custom:tenant_id", "tenant_id")
        or _first(ctx, "tenant_id")
        or os.environ.get("HOMEBASE_DEFAULT_TENANT", "homebase")
    )
    caller = _first(event, "caller", default=_first(ctx, "caller", default="gateway"))
    params.pop("tenant_id", None)
    return tool_name, params, tenant_id, confirm_token, caller


def _serialize(result):
    if isinstance(result, ConfirmationContract):
        return {
            "requires_confirmation": True,
            "action": result.action,
            "connector": result.connector,
            "summary": result.summary,
            "parameters": result.parameters,
            "confirmation_token": result.confirmation_token,
        }
    return {"requires_confirmation": False, "result": result}


def build_shim(connector, *, identity=None, api=None):
    identity = identity if identity is not None else AgentCoreIdentityClient()
    api = api if api is not None else make_api()
    return ConnectorShim(connector, ConnectorCredentials(identity), api)


def handle(event, context=None, *, shim=None):
    """Core, testable handler. `shim` is injected in tests; production builds one
    from the environment (identity provider ARN, connector)."""
    tool_name, params, tenant_id, confirm_token, caller = _extract(event, context)
    catalog_name = _catalog_name(tool_name)
    tool = TOOLS.get(catalog_name)
    if tool is None:
        return {"error": "unknown_tool", "tool": tool_name}

    active = shim or build_shim(tool.connector)
    try:
        result = active.call(
            tenant_id, catalog_name, params, confirm_token=confirm_token, caller=caller
        )
    except UnknownToolError:
        return {"error": "unknown_tool", "tool": tool_name}
    return _serialize(result)


def handler(event, context=None):
    """AWS Lambda entrypoint."""
    return handle(event, context)
