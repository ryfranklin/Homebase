"""Connector tools for the agent's tool-use loop.

The agent reaches the six live connectors by invoking their shim Lambdas directly
(homebase-<env>-connector-<connector>). The shim resolves the tenant's OAuth token
from AgentCore Identity and calls the vendor API, so the agent only needs
lambda:InvokeFunction plus the tenant id it already carries from the request. This
deliberately does NOT go through the AgentCore Gateway: the Gateway authorizes with
a Cognito JWT, which the agent runtime does not hold (the BFF passes only the
verified user/tenant, not the raw token).

Only READ tools are exposed here; writes stay behind the shim's confirmation gate
and are not offered to the model.
"""

from __future__ import annotations

import json

# Converse tool specs (read-first). The shim auto-resolves a Slack channel name and
# the Jira cloudId, so the model only supplies the obvious inputs.
CONNECTOR_TOOLS = [
    {
        "toolSpec": {
            "name": "slack_read_messages",
            "description": (
                "Read recent messages from a Slack channel. Accepts a channel name "
                "(e.g. 'general') or id. Use for questions about Slack conversations."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "channel": {"type": "string", "description": "Channel name or id"},
                        "limit": {"type": "integer", "description": "Max messages (default 25)"},
                    },
                    "required": ["channel"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "gmail_search_messages",
            "description": "Search the user's Gmail. Query uses Gmail search syntax (e.g. 'from:me newer_than:7d').",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "gcal_list_events",
            "description": "List the user's Google Calendar events. Optional RFC3339 timeMin/timeMax bound the window.",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "timeMin": {"type": "string"},
                        "timeMax": {"type": "string"},
                        "q": {"type": "string"},
                        "maxResults": {"type": "integer"},
                    },
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "gdrive_search_files",
            "description": "Search the user's Google Drive files. Query uses Drive query syntax (e.g. \"name contains 'report'\").",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "jira_search_issues",
            "description": (
                "Search Jira issues with JQL. The query must be bounded (include a "
                "restriction such as project= or a date range); the site is resolved "
                "automatically."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "jql": {"type": "string", "description": "Bounded JQL query"},
                        "maxResults": {"type": "integer"},
                    },
                    "required": ["jql"],
                }
            },
        }
    },
]

# Tool name -> connector key (the shim function suffix). Atlassian backs Jira.
_TOOL_TO_CONNECTOR = {
    "slack_read_messages": "slack",
    "gmail_search_messages": "gmail",
    "gcal_list_events": "gcal",
    "gdrive_search_files": "gdrive",
    "jira_search_issues": "atlassian",
}


class ConnectorClient:
    """Invokes the connector shim Lambdas. The boto3 lambda client is injected so
    tests pass a fake and make no AWS calls."""

    def __init__(self, lambda_client, name_prefix, *, tools=None):
        self._lambda = lambda_client
        self._prefix = name_prefix
        self._tools = tools if tools is not None else CONNECTOR_TOOLS

    def tool_specs(self):
        return list(self._tools)

    def tool_names(self):
        return set(_TOOL_TO_CONNECTOR)

    def call(self, tool_name, arguments, tenant_id) -> dict:
        connector = _TOOL_TO_CONNECTOR.get(tool_name)
        if connector is None:
            raise ValueError(f"unknown connector tool: {tool_name}")
        function_name = f"{self._prefix}-connector-{connector}"
        payload = {"name": tool_name, "arguments": {**(arguments or {}), "tenant_id": tenant_id}}
        resp = self._lambda.invoke(
            FunctionName=function_name,
            Payload=json.dumps(payload).encode("utf-8"),
        )
        raw = resp["Payload"].read()
        return json.loads(raw or b"{}")
