"""Connector HTTP dispatcher for the shim Lambda.

Maps each catalog tool to a concrete REST request against its vendor API, using
the tenant's bearer token (resolved by AgentCore Identity, never hardcoded). The
dispatcher is the `api` callable the ConnectorShim delegates to; the write gate in
gate.py decides whether a write ever reaches here (only a confirmed write does).

Request construction is unit-tested offline with a fake transport. Live end-to-end
calls require the by-hand OAuth setup (docs/connectors.md) plus, for QuickBooks and
Atlassian, the per-tenant realm/cloud id supplied in the tool parameters.

Uses only the standard library (urllib) plus the Lambda runtime's boto3 elsewhere,
so the shim package needs no third-party dependencies.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request


class ConnectorApiError(RuntimeError):
    pass


class UnsupportedToolError(ConnectorApiError):
    pass


def _bearer(token):
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


# Each builder returns a Request(method, url, headers, body_bytes|None). Bodies are
# JSON unless a vendor requires otherwise. Only documented, least-privilege paths.
def _gmail_search(params, token):
    q = urllib.parse.urlencode({"q": params.get("query", "")})
    return "GET", f"https://gmail.googleapis.com/gmail/v1/users/me/messages?{q}", _bearer(token), None


def _gmail_send(params, token):
    # params["raw"] is a base64url-encoded RFC 2822 message (built by the caller).
    body = json.dumps({"raw": params["raw"]}).encode("utf-8")
    h = _bearer(token) | {"Content-Type": "application/json"}
    return "POST", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", h, body


def _gcal_list(params, token):
    query = {k: v for k, v in params.items() if k in ("timeMin", "timeMax", "q", "maxResults")}
    cal = urllib.parse.quote(params.get("calendarId", "primary"))
    qs = urllib.parse.urlencode(query)
    return "GET", f"https://www.googleapis.com/calendar/v3/calendars/{cal}/events?{qs}", _bearer(token), None


def _gcal_create(params, token):
    cal = urllib.parse.quote(params.get("calendarId", "primary"))
    body = json.dumps(params.get("event", {})).encode("utf-8")
    h = _bearer(token) | {"Content-Type": "application/json"}
    return "POST", f"https://www.googleapis.com/calendar/v3/calendars/{cal}/events", h, body


def _gdrive_search(params, token):
    qs = urllib.parse.urlencode({"q": params.get("query", ""), "fields": "files(id,name,mimeType,modifiedTime)"})
    return "GET", f"https://www.googleapis.com/drive/v3/files?{qs}", _bearer(token), None


def _gdrive_update(params, token):
    file_id = urllib.parse.quote(params["fileId"])
    body = json.dumps(params.get("metadata", {})).encode("utf-8")
    h = _bearer(token) | {"Content-Type": "application/json"}
    return "PATCH", f"https://www.googleapis.com/drive/v3/files/{file_id}", h, body


def _slack_read(params, token):
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if k in ("channel", "limit", "oldest", "latest")})
    return "GET", f"https://slack.com/api/conversations.history?{qs}", _bearer(token), None


def _slack_post(params, token):
    body = json.dumps({"channel": params["channel"], "text": params["text"]}).encode("utf-8")
    h = _bearer(token) | {"Content-Type": "application/json; charset=utf-8"}
    return "POST", "https://slack.com/api/chat.postMessage", h, body


def _qbo_read(params, token):
    realm = urllib.parse.quote(params["realmId"])
    report = urllib.parse.quote(params.get("report", "ProfitAndLoss"))
    return "GET", f"https://quickbooks.api.intuit.com/v3/company/{realm}/reports/{report}", _bearer(token), None


def _qbo_create_invoice(params, token):
    realm = urllib.parse.quote(params["realmId"])
    body = json.dumps(params["invoice"]).encode("utf-8")
    h = _bearer(token) | {"Content-Type": "application/json"}
    return "POST", f"https://quickbooks.api.intuit.com/v3/company/{realm}/invoice", h, body


def _jira_search(params, token):
    cloud = urllib.parse.quote(params["cloudId"])
    qs = urllib.parse.urlencode({"jql": params.get("jql", ""), "maxResults": params.get("maxResults", 25)})
    return "GET", f"https://api.atlassian.com/ex/jira/{cloud}/rest/api/3/search?{qs}", _bearer(token), None


def _jira_create(params, token):
    cloud = urllib.parse.quote(params["cloudId"])
    body = json.dumps({"fields": params["fields"]}).encode("utf-8")
    h = _bearer(token) | {"Content-Type": "application/json"}
    return "POST", f"https://api.atlassian.com/ex/jira/{cloud}/rest/api/3/issue", h, body


# Catalog tool name (dot form) -> request builder.
_BUILDERS = {
    "gmail.search_messages": _gmail_search,
    "gmail.send_message": _gmail_send,
    "gcal.list_events": _gcal_list,
    "gcal.create_event": _gcal_create,
    "gdrive.search_files": _gdrive_search,
    "gdrive.update_file": _gdrive_update,
    "slack.read_messages": _slack_read,
    "slack.post_message": _slack_post,
    "qbo.read_reports": _qbo_read,
    "qbo.create_invoice": _qbo_create_invoice,
    "jira.search_issues": _jira_search,
    "jira.create_issue": _jira_create,
}


def _default_transport(method, url, headers, body):
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=25) as resp:  # noqa: S310 (documented vendor hosts)
        raw = resp.read()
    return json.loads(raw or b"{}")


def make_api(transport=None):
    """Return an `api(connector, tool_name, params, token)` callable.

    `transport(method, url, headers, body) -> dict` is injected in tests; the
    default performs the real HTTPS call. `connector` is accepted for signature
    compatibility with ConnectorShim; routing is by tool_name.
    """
    send = transport or _default_transport

    def api(connector, tool_name, params, token):
        builder = _BUILDERS.get(tool_name)
        if builder is None:
            raise UnsupportedToolError(tool_name)
        method, url, headers, body = builder(params or {}, token)
        return send(method, url, headers, body)

    return api
