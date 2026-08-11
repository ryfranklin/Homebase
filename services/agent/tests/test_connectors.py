import io
import json
import unittest

import _bootstrap  # noqa: F401

from homebase_agent.connectors import ConnectorClient


class FakeLambda:
    def __init__(self, payload):
        self._payload = payload
        self.invocations = []

    def invoke(self, FunctionName, Payload):  # noqa: N803 (boto3 arg names)
        self.invocations.append((FunctionName, json.loads(Payload)))
        return {"Payload": io.BytesIO(json.dumps(self._payload).encode("utf-8"))}


class ConnectorClientTests(unittest.TestCase):
    def test_routes_to_shim_and_injects_tenant(self):
        lam = FakeLambda({"requires_confirmation": False, "result": {"ok": True}})
        client = ConnectorClient(lam, "homebase-prod")
        out = client.call("jira_search_issues", {"jql": "project=X"}, "homebase")

        fn, payload = lam.invocations[0]
        # jira maps to the atlassian shim.
        self.assertEqual(fn, "homebase-prod-connector-atlassian")
        self.assertEqual(payload["name"], "jira_search_issues")
        self.assertEqual(payload["arguments"]["tenant_id"], "homebase")
        self.assertEqual(payload["arguments"]["jql"], "project=X")
        self.assertTrue(out["result"]["ok"])

    def test_slack_tool_maps_to_slack_shim(self):
        lam = FakeLambda({"result": {"messages": []}})
        client = ConnectorClient(lam, "homebase-prod")
        client.call("slack_read_messages", {"channel": "general"}, "homebase")
        self.assertEqual(lam.invocations[0][0], "homebase-prod-connector-slack")

    def test_unknown_tool_raises(self):
        client = ConnectorClient(FakeLambda({}), "homebase-prod")
        with self.assertRaises(ValueError):
            client.call("bogus_tool", {}, "homebase")

    def test_tool_specs_include_the_five_read_tools(self):
        client = ConnectorClient(FakeLambda({}), "homebase-prod")
        names = {t["toolSpec"]["name"] for t in client.tool_specs()}
        self.assertEqual(
            names,
            {
                "slack_read_messages",
                "gmail_search_messages",
                "gcal_list_events",
                "gdrive_search_files",
                "jira_search_issues",
            },
        )


if __name__ == "__main__":
    unittest.main()
