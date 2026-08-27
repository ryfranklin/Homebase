"""The connector tool catalog.

Six connectors, each read-first: read tools carry read-only scopes, and a write
tool exists only where a write is genuinely needed, carrying the minimal write
scope. There are no blanket scopes, and there is no ingest/index tool: connector
data is fetched live per query, never written into the corpus (ADR-004).
"""

from __future__ import annotations

from dataclasses import dataclass

READ = "read"
WRITE = "write"

# The connectors. Homebase authenticates each independently through AgentCore
# Identity; it does not reuse any other app's tokens. Jira and Confluence are
# distinct connectors (separate shims/tools) backed by the same Atlassian OAuth
# provider, so one Atlassian consent (unioned scopes) covers both.
CONNECTORS = ("gmail", "gcal", "gdrive", "slack", "quickbooks", "atlassian", "confluence", "web")


@dataclass(frozen=True)
class Tool:
    connector: str
    name: str
    access: str  # READ or WRITE
    scopes: tuple
    description: str


_TOOL_LIST = [
    # Gmail
    Tool("gmail", "gmail.search_messages", READ, ("gmail.readonly",), "Search Gmail messages"),
    Tool("gmail", "gmail.send_message", WRITE, ("gmail.send",), "Send an email"),
    # Google Calendar
    Tool("gcal", "gcal.list_events", READ, ("calendar.readonly",), "List calendar events"),
    Tool("gcal", "gcal.create_event", WRITE, ("calendar.events",), "Create a calendar event"),
    # Google Drive
    Tool("gdrive", "gdrive.search_files", READ, ("drive.readonly",), "Search Drive files"),
    Tool("gdrive", "gdrive.update_file", WRITE, ("drive.file",), "Create or modify a Drive file"),
    # Slack
    Tool("slack", "slack.read_messages", READ, ("channels:history", "groups:history"), "Read Slack messages from a channel (accepts a channel name or id)"),
    Tool("slack", "slack.post_message", WRITE, ("chat:write",), "Post a Slack message"),
    # QuickBooks
    Tool("quickbooks", "qbo.read_reports", READ, ("com.intuit.quickbooks.accounting.read",), "Read QuickBooks reports"),
    Tool("quickbooks", "qbo.create_invoice", WRITE, ("com.intuit.quickbooks.accounting.write",), "Create a QuickBooks invoice"),
    # Atlassian (Jira / Confluence) — same OAuth provider, unioned scopes.
    Tool("atlassian", "jira.search_issues", READ, ("read:jira-work",), "Search Jira issues"),
    Tool("atlassian", "jira.create_issue", WRITE, ("write:jira-work",), "Create a Jira issue"),
    Tool("confluence", "confluence.search", READ, ("search:confluence", "read:page:confluence", "read:space:confluence"), "Search Confluence pages with a CQL query"),
    # Web (Tavily): no OAuth, authenticated by a static API key (ApiKeyCredentials).
    # Read-only by nature; empty scopes and no write tool. Fetching is delegated to
    # Tavily's server-side extract, so the shim never dereferences a model-supplied URL.
    Tool("web", "web.search", READ, (), "Search the public web for current information"),
    Tool("web", "web.fetch", READ, (), "Fetch and extract the readable content of web page URLs"),
]

TOOLS = {tool.name: tool for tool in _TOOL_LIST}


def read_scopes_for(connector: str) -> tuple:
    """All read scopes a connector needs (the default, least-privilege request)."""
    scopes: list = []
    for tool in _TOOL_LIST:
        if tool.connector == connector and tool.access == READ:
            scopes.extend(tool.scopes)
    return tuple(dict.fromkeys(scopes))


def write_tools() -> list:
    return [tool for tool in _TOOL_LIST if tool.access == WRITE]
