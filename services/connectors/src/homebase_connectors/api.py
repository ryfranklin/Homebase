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
    # Combine an optional folder scope with an optional Drive-syntax query, so the model
    # can list a folder's contents by passing folder_id (-> "'<id>' in parents") without
    # hand-writing that clause. Both are optional; with neither, Drive returns the first
    # page of all files. folder_id is quote-stripped since it is interpolated into a
    # single-quoted clause (Drive ids are [A-Za-z0-9_-], so this only guards malformed input).
    clauses = []
    folder_id = str(params.get("folder_id") or "").replace("'", "")
    if folder_id:
        clauses.append(f"'{folder_id}' in parents")
    if params.get("query"):
        clauses.append(f"({params['query']})")
    fields = "files(id,name,mimeType,modifiedTime,parents,webViewLink)"
    qs = urllib.parse.urlencode({"q": " and ".join(clauses), "fields": fields})
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


def _is_slack_id(value):
    # Slack channel IDs are uppercase alphanumerics starting with C (public), G
    # (private/group), or D (DM). Channel NAMES are always lowercased by Slack, so a
    # value with any lowercase char (or a leading '#') is a name, not an id.
    v = value or ""
    return bool(v) and v[0] in "CGD" and v.isalnum() and v == v.upper()


def _slack_resolve_channel(name, token, send):
    """Resolve a Slack channel name to its id via conversations.list (needs the
    channels:read/groups:read scope). Paginates a bounded number of pages so a huge
    workspace can't loop forever; raises if the channel is not found."""
    wanted = name.lstrip("#")
    cursor = ""
    for _ in range(10):  # up to 10 pages of 200 = 2000 channels, then give up
        query = {"types": "public_channel,private_channel", "limit": 200}
        if cursor:
            query["cursor"] = cursor
        qs = urllib.parse.urlencode(query)
        data = send("GET", f"https://slack.com/api/conversations.list?{qs}", _bearer(token), None)
        if not data.get("ok"):
            raise ConnectorApiError(f"slack conversations.list failed: {data.get('error')}")
        for ch in data.get("channels", []):
            if ch.get("name") == wanted:
                return ch["id"]
        cursor = (data.get("response_metadata") or {}).get("next_cursor") or ""
        if not cursor:
            break
    raise ConnectorApiError(f"slack channel not found: {name}")


def _slack_read_handler(params, token, send):
    """Read messages, accepting either a channel id (C0...) or a channel name
    (resolved to its id first). Slack's conversations.history only accepts an id."""
    params = dict(params or {})
    channel = params.get("channel", "")
    if channel and not _is_slack_id(channel):
        params["channel"] = _slack_resolve_channel(channel, token, send)
    method, url, headers, body = _slack_read(params, token)
    return send(method, url, headers, body)


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
    # The classic /rest/api/3/search was removed (HTTP 410) in May 2025; use the
    # enhanced /rest/api/3/search/jql. It returns only issue ids unless `fields` is
    # given, so default to *navigable (the common navigable fields).
    cloud = urllib.parse.quote(params["cloudId"])
    qs = urllib.parse.urlencode(
        {
            "jql": params.get("jql", ""),
            # Cap server-side: the "bounded query" convention lives in the tool
            # description (advisory to the model), so enforce a hard result ceiling here.
            "maxResults": _clamp_int(params.get("maxResults"), 25, 1, 100),
            "fields": params.get("fields", "*navigable"),
        }
    )
    return "GET", f"https://api.atlassian.com/ex/jira/{cloud}/rest/api/3/search/jql?{qs}", _bearer(token), None


def _jira_create(params, token):
    cloud = urllib.parse.quote(params["cloudId"])
    body = json.dumps({"fields": params["fields"]}).encode("utf-8")
    h = _bearer(token) | {"Content-Type": "application/json"}
    return "POST", f"https://api.atlassian.com/ex/jira/{cloud}/rest/api/3/issue", h, body


def _atlassian_resolve_cloud_id(token, send):
    """Resolve the accessible Atlassian site's cloudId (shared by Jira and
    Confluence) so callers need not know it. Uses the first accessible resource
    (the single-tenant seed has one site)."""
    data = send("GET", "https://api.atlassian.com/oauth/token/accessible-resources", _bearer(token), None)
    if isinstance(data, list) and data:
        return data[0]["id"]
    raise ConnectorApiError("no accessible Atlassian site for this token")


def _jira_search_handler(params, token, send):
    """Search issues, resolving cloudId automatically when the caller omits it."""
    params = dict(params or {})
    if not params.get("cloudId"):
        params["cloudId"] = _atlassian_resolve_cloud_id(token, send)
    method, url, headers, body = _jira_search(params, token)
    return send(method, url, headers, body)


def _jira_create_handler(params, token, send):
    """Create an issue, resolving cloudId automatically when the caller omits it, so
    the caller only supplies `fields` (project, issuetype, summary, description,
    optional parent). The write gate has already confirmed by the time this runs."""
    params = dict(params or {})
    if not params.get("cloudId"):
        params["cloudId"] = _atlassian_resolve_cloud_id(token, send)
    method, url, headers, body = _jira_create(params, token)
    return send(method, url, headers, body)


def _confluence_search(params, token):
    cloud = urllib.parse.quote(params["cloudId"])
    qs = urllib.parse.urlencode(
        {"cql": params.get("cql", ""), "limit": _clamp_int(params.get("limit"), 25, 1, 100)}
    )
    return "GET", f"https://api.atlassian.com/ex/confluence/{cloud}/wiki/rest/api/search?{qs}", _bearer(token), None


def _confluence_search_handler(params, token, send):
    """Search Confluence with CQL, resolving cloudId automatically when omitted."""
    params = dict(params or {})
    if not params.get("cloudId"):
        params["cloudId"] = _atlassian_resolve_cloud_id(token, send)
    method, url, headers, body = _confluence_search(params, token)
    return send(method, url, headers, body)


# Web search / fetch (Tavily). No OAuth: `token` is the Tavily API key resolved from
# Secrets Manager by ApiKeyCredentials. Both builders POST to a PINNED vendor host
# (api.tavily.com); the model never supplies a host. web.fetch delegates the actual
# page retrieval to Tavily's server-side /extract, so a model-chosen URL is fetched
# by Tavily, NOT by this Lambda -- this is the SSRF containment: our Lambda's only
# egress is to the one vendor host, never to model-controlled internal addresses.
_TAVILY_SEARCH_URL = "https://api.tavily.com/search"
_TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"
_WEB_MAX_RESULTS = 10  # hard server-side cap regardless of what the model requests
_WEB_MAX_URLS = 5


def _clamp_int(value, default, lo, hi):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _web_search(params, token):
    body = json.dumps(
        {
            "query": str(params.get("query", ""))[:2000],
            "max_results": _clamp_int(params.get("max_results"), 5, 1, _WEB_MAX_RESULTS),
            "search_depth": "advanced" if params.get("search_depth") == "advanced" else "basic",
            "include_answer": True,
        }
    ).encode("utf-8")
    h = _bearer(token) | {"Content-Type": "application/json"}
    return "POST", _TAVILY_SEARCH_URL, h, body


def _web_fetch(params, token):
    urls = params.get("urls") or params.get("url") or []
    if isinstance(urls, str):
        urls = [urls]
    urls = [str(u) for u in list(urls)[:_WEB_MAX_URLS] if u]
    body = json.dumps({"urls": urls}).encode("utf-8")
    h = _bearer(token) | {"Content-Type": "application/json"}
    return "POST", _TAVILY_EXTRACT_URL, h, body


# Catalog tool name (dot form) -> request builder.
_BUILDERS = {
    "gmail.search_messages": _gmail_search,
    "gmail.send_message": _gmail_send,
    "gcal.list_events": _gcal_list,
    "gcal.create_event": _gcal_create,
    "gdrive.search_files": _gdrive_search,
    "gdrive.update_file": _gdrive_update,
    "slack.post_message": _slack_post,
    "qbo.read_reports": _qbo_read,
    "qbo.create_invoice": _qbo_create_invoice,
    "jira.create_issue": _jira_create,
    "web.search": _web_search,
    "web.fetch": _web_fetch,
}


# Tools that orchestrate more than one request need the transport, so they are
# handlers `handler(params, token, send) -> dict` rather than pure request builders.
_HANDLERS = {
    "slack.read_messages": _slack_read_handler,
    "jira.search_issues": _jira_search_handler,
    "jira.create_issue": _jira_create_handler,
    "confluence.search": _confluence_search_handler,
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
        handler = _HANDLERS.get(tool_name)
        if handler is not None:
            return handler(params or {}, token, send)
        builder = _BUILDERS.get(tool_name)
        if builder is None:
            raise UnsupportedToolError(tool_name)
        method, url, headers, body = builder(params or {}, token)
        return send(method, url, headers, body)

    return api
