"""Offline tests for the shim Lambda handler and the HTTP dispatcher. No AWS, no
network: identity and transport are injected."""

import unittest

import _bootstrap  # noqa: F401

from homebase_connectors.api import UnsupportedToolError, make_api
from homebase_connectors.confirmation import make_token
from homebase_connectors.handler import handle
from homebase_connectors.identity import ConnectorCredentials
from homebase_connectors.shim import ConnectorShim


class _FakeIdentity:
    def __init__(self):
        self.keys = []

    def get_token(self, key):
        self.keys.append(key)
        return f"tok:{key}"


def _shim(connector, calls):
    def api(conn, tool, params, token):
        calls.append((conn, tool, params, token))
        return {"ok": True, "tool": tool}

    return ConnectorShim(connector, ConnectorCredentials(_FakeIdentity()), api)


class HandlerGateTests(unittest.TestCase):
    def test_read_executes_and_maps_underscore_tool_name(self):
        calls = []
        # Gateway sends the underscore form; handler maps to slack.read_messages.
        event = {"name": "slack_read_messages", "arguments": {"channel": "C1", "tenant_id": "t1"}}
        out = handle(event, shim=_shim("slack", calls))
        self.assertFalse(out["requires_confirmation"])
        self.assertEqual(out["result"]["tool"], "slack.read_messages")
        self.assertEqual(calls[0][1], "slack.read_messages")

    def test_write_is_gated_returns_contract_no_api_call(self):
        calls = []
        event = {"name": "slack_post_message", "arguments": {"channel": "C1", "text": "hi", "tenant_id": "t1"}}
        out = handle(event, shim=_shim("slack", calls))
        self.assertTrue(out["requires_confirmation"])
        self.assertEqual(out["action"], "slack.post_message")
        self.assertTrue(out["confirmation_token"])
        self.assertEqual(calls, [])  # gated write never calls the api

    def test_confirmed_write_executes(self):
        calls = []
        params = {"channel": "C1", "text": "hi"}
        token = make_token("slack.post_message", params)
        event = {
            "name": "slack_post_message",
            "arguments": {**params, "tenant_id": "t1", "confirmation_token": token},
        }
        out = handle(event, shim=_shim("slack", calls))
        self.assertFalse(out["requires_confirmation"])
        self.assertEqual(len(calls), 1)

    def test_unknown_tool(self):
        out = handle({"name": "bogus_tool", "arguments": {}}, shim=_shim("slack", []))
        self.assertEqual(out["error"], "unknown_tool")

    def test_authorization_required_is_surfaced(self):
        from homebase_connectors.lambda_identity import AuthorizationRequiredError

        class _NeedsAuthIdentity:
            def get_token(self, key):
                raise AuthorizationRequiredError("https://consent.example/authorize?x=1")

        shim = ConnectorShim("slack", ConnectorCredentials(_NeedsAuthIdentity()), lambda *a: {"ok": True})
        out = handle({"name": "slack_read_messages", "arguments": {"channel": "C1", "tenant_id": "t1"}}, shim=shim)
        self.assertTrue(out["requires_authorization"])
        self.assertIn("consent.example", out["authorization_url"])

    def test_tenant_defaults_when_no_claim(self):
        calls = []
        # No tenant_id in args or claims -> falls back to the seed default.
        handle({"name": "slack_read_messages", "arguments": {"channel": "C1"}}, shim=_shim("slack", calls))
        # token key carries the default tenant "homebase"
        # (the fake identity records the namespaced key)
        # calls[0][3] is the token string "tok:homebase/slack"
        self.assertIn("homebase/slack", calls[0][3])


class ApiDispatcherTests(unittest.TestCase):
    def _capture(self):
        sent = {}

        def transport(method, url, headers, body):
            sent.update(method=method, url=url, headers=headers, body=body)
            return {"ok": True}

        return make_api(transport), sent

    def test_slack_read_builds_get(self):
        api, sent = self._capture()
        api("slack", "slack.read_messages", {"channel": "C1", "limit": 5}, "TOKEN")
        self.assertEqual(sent["method"], "GET")
        self.assertIn("conversations.history", sent["url"])
        self.assertIn("channel=C1", sent["url"])
        self.assertEqual(sent["headers"]["Authorization"], "Bearer TOKEN")

    def test_slack_read_with_id_makes_a_single_history_call(self):
        calls = []

        def transport(method, url, headers, body):
            calls.append(url)
            return {"ok": True, "messages": []}

        api = make_api(transport)
        api("slack", "slack.read_messages", {"channel": "C011HMPF82E"}, "T")
        # A real id needs no resolution: exactly one call, to conversations.history.
        self.assertEqual(len(calls), 1)
        self.assertIn("conversations.history", calls[0])

    def test_slack_read_resolves_channel_name_to_id(self):
        calls = []

        def transport(method, url, headers, body):
            calls.append(url)
            if "conversations.list" in url:
                return {"ok": True, "channels": [{"id": "C0ABC1234", "name": "general"}]}
            return {"ok": True, "messages": []}

        api = make_api(transport)
        api("slack", "slack.read_messages", {"channel": "general"}, "T")
        # First resolves the name via conversations.list, then reads with the id.
        self.assertIn("conversations.list", calls[0])
        self.assertIn("conversations.history", calls[1])
        self.assertIn("channel=C0ABC1234", calls[1])

    def test_slack_read_resolves_name_with_leading_hash(self):
        def transport(method, url, headers, body):
            if "conversations.list" in url:
                return {"ok": True, "channels": [{"id": "C0XYZ", "name": "general"}]}
            return {"ok": True, "messages": []}

        api = make_api(transport)
        # Should not raise: "#general" is treated as the name "general".
        api("slack", "slack.read_messages", {"channel": "#general"}, "T")

    def test_slack_read_unknown_channel_name_raises(self):
        from homebase_connectors.api import ConnectorApiError

        def transport(method, url, headers, body):
            return {"ok": True, "channels": []}  # no next_cursor -> single page

        api = make_api(transport)
        with self.assertRaises(ConnectorApiError):
            api("slack", "slack.read_messages", {"channel": "nope"}, "T")

    def test_gmail_search_builds_query(self):
        api, sent = self._capture()
        api("gmail", "gmail.search_messages", {"query": "from:me"}, "T")
        self.assertEqual(sent["method"], "GET")
        self.assertIn("gmail/v1/users/me/messages", sent["url"])
        self.assertIn("q=from", sent["url"])

    def test_jira_search_uses_cloud_id(self):
        api, sent = self._capture()
        api("atlassian", "jira.search_issues", {"cloudId": "abc", "jql": "project=X"}, "T")
        self.assertIn("/ex/jira/abc/rest/api/3/search", sent["url"])

    def test_unsupported_tool_raises(self):
        api, _ = self._capture()
        with self.assertRaises(UnsupportedToolError):
            api("slack", "slack.delete_everything", {}, "T")


if __name__ == "__main__":
    unittest.main()
