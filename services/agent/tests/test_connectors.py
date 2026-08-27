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

    def test_tool_specs_include_the_read_tools(self):
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
                "confluence_search",
                "web_search",
                "web_fetch",
            },
        )

    def test_web_tools_map_to_the_web_shim(self):
        for tool in ("web_search", "web_fetch"):
            lam = FakeLambda({"requires_confirmation": False, "result": {"results": []}})
            client = ConnectorClient(lam, "homebase-prod")
            client.call(tool, {"query": "hello"}, "homebase")
            self.assertEqual(lam.invocations[0][0], "homebase-prod-connector-web")

    def test_gdrive_tool_exposes_folder_id_for_folder_listing(self):
        client = ConnectorClient(FakeLambda({}), "homebase-prod")
        gdrive = next(t["toolSpec"] for t in client.tool_specs() if t["toolSpec"]["name"] == "gdrive_search_files")
        props = gdrive["inputSchema"]["json"]["properties"]
        self.assertIn("folder_id", props)  # lets the model list a folder's contents
        # query is now optional (a folder listing needs only folder_id).
        self.assertNotIn("required", gdrive["inputSchema"]["json"])

    def test_confluence_tool_maps_to_confluence_shim(self):
        lam = FakeLambda({"result": {"results": []}})
        client = ConnectorClient(lam, "homebase-prod")
        client.call("confluence_search", {"cql": "type=page"}, "homebase")
        self.assertEqual(lam.invocations[0][0], "homebase-prod-connector-confluence")


if __name__ == "__main__":
    unittest.main()
