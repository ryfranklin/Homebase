import pathlib
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_connectors.api import make_api
from homebase_connectors.catalog import CONNECTORS, READ, WRITE, TOOLS, read_scopes_for, write_tools
from homebase_connectors.gate import is_confirmation
from homebase_connectors.identity import ConnectorCredentials, tenant_namespaced_key
from homebase_connectors.shim import ConnectorShim

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"


class CatalogTests(unittest.TestCase):
    def test_all_connectors_present(self):
        self.assertEqual(set(CONNECTORS), {t.connector for t in TOOLS.values()})
        self.assertEqual(len(CONNECTORS), 8)

    def test_read_first_every_connector_has_a_read_tool(self):
        read_connectors = {t.connector for t in TOOLS.values() if t.access == READ}
        for connector in CONNECTORS:
            self.assertIn(connector, read_connectors, f"{connector} lacks a read tool")

    def test_oauth_connectors_have_read_scopes_web_has_none(self):
        # OAuth connectors request least-privilege read scopes; the web connector is
        # no-OAuth (a static API key), so it intentionally carries no scopes.
        for connector in CONNECTORS:
            if connector == "web":
                self.assertEqual(read_scopes_for(connector), ())
            else:
                self.assertTrue(read_scopes_for(connector), f"{connector} lacks read scopes")

    def test_no_blanket_scopes(self):
        for tool in TOOLS.values():
            for scope in tool.scopes:
                self.assertNotIn(scope, ("*", "full", "admin"), f"{tool.name} has a blanket scope")

    def test_write_scopes_only_on_write_tools(self):
        read_scopes = {s for t in TOOLS.values() if t.access == READ for s in t.scopes}
        write_scopes = {s for t in TOOLS.values() if t.access == WRITE for s in t.scopes}
        # A write scope must never appear on a read tool.
        self.assertEqual(write_scopes & read_scopes, set())

    def test_no_ingest_or_index_tool(self):
        # ADR-004: connector data is fetched live, never written into the corpus.
        for name in TOOLS:
            self.assertNotRegex(name, r"ingest|index|embed|vector|corpus")

    def test_source_has_no_corpus_ingestion_path(self):
        # Guard: nothing in the connector package touches the vector store / S3.
        joined = "\n".join(p.read_text() for p in SRC.rglob("*.py"))
        for forbidden in ("s3vectors", "corpus_bucket", "put_object", "start_ingestion_job", "KnowledgeBase"):
            self.assertNotIn(forbidden, joined, f"connector code must not reference {forbidden}")


class IdentityTests(unittest.TestCase):
    def test_tenant_namespacing(self):
        self.assertEqual(tenant_namespaced_key("t1", "slack"), "t1/slack")
        self.assertNotEqual(tenant_namespaced_key("t1", "slack"), tenant_namespaced_key("t2", "slack"))

    def test_requires_tenant_and_connector(self):
        with self.assertRaises(ValueError):
            tenant_namespaced_key("", "slack")

    def test_credentials_use_namespaced_key(self):
        class FakeIdentity:
            def __init__(self):
                self.keys = []

            def get_token(self, key):
                self.keys.append(key)
                return f"token-for-{key}"

        fake = FakeIdentity()
        creds = ConnectorCredentials(fake)
        self.assertEqual(creds.get_access_token("t1", "gmail"), "token-for-t1/gmail")
        self.assertEqual(fake.keys, ["t1/gmail"])


class ShimTests(unittest.TestCase):
    def _shim(self):
        class FakeIdentity:
            def get_token(self, key):
                return f"token:{key}"

        calls = []

        def api(connector, tool, params, token):
            calls.append((connector, tool, params, token))
            return {"ok": True}

        shim = ConnectorShim("slack", ConnectorCredentials(FakeIdentity()), api)
        return shim, calls

    def test_read_calls_api_with_tenant_token(self):
        shim, calls = self._shim()
        out = shim.call("t1", "slack.read_messages", {"channel": "C1"})
        self.assertEqual(out, {"ok": True})
        self.assertEqual(calls[0][3], "token:t1/slack")  # per-tenant token used

    def test_write_is_gated_and_never_fetches_token(self):
        shim, calls = self._shim()
        out = shim.call("t1", "slack.post_message", {"text": "hi"})
        self.assertTrue(is_confirmation(out))
        self.assertEqual(calls, [])  # no API call, no token use on an unconfirmed write

    def test_confirmed_write_executes(self):
        shim, calls = self._shim()
        from homebase_connectors.confirmation import make_token

        params = {"text": "hi", "channel": "C1"}
        token = make_token("slack.post_message", params)
        out = shim.call("t1", "slack.post_message", params, confirm_token=token)
        self.assertEqual(out, {"ok": True})
        self.assertEqual(len(calls), 1)


class _FakeSecrets:
    """Minimal stand-in for a boto3 secretsmanager client."""

    def __init__(self, secret_string):
        self._secret_string = secret_string
        self.calls = 0

    def get_secret_value(self, SecretId):  # noqa: N803 (boto3 arg name)
        self.calls += 1
        return {"SecretString": self._secret_string}


class ApiKeyCredentialsTests(unittest.TestCase):
    def test_reads_raw_string_key(self):
        from homebase_connectors.identity import ApiKeyCredentials

        creds = ApiKeyCredentials(_FakeSecrets("tvly-RAW-KEY"), "homebase-dev-tavily")
        self.assertEqual(creds.get_access_token("t1", "web"), "tvly-RAW-KEY")

    def test_reads_json_api_key_field(self):
        from homebase_connectors.identity import ApiKeyCredentials

        creds = ApiKeyCredentials(_FakeSecrets('{"api_key": "tvly-JSON-KEY"}'), "sid")
        self.assertEqual(creds.get_access_token("t1", "web"), "tvly-JSON-KEY")

    def test_caches_after_first_read(self):
        from homebase_connectors.identity import ApiKeyCredentials

        fake = _FakeSecrets("tvly-KEY")
        creds = ApiKeyCredentials(fake, "sid")
        creds.get_access_token("t1", "web")
        creds.get_access_token("t1", "web")
        self.assertEqual(fake.calls, 1)  # tenant-independent key fetched once

    def test_key_is_not_tenant_scoped(self):
        from homebase_connectors.identity import ApiKeyCredentials

        creds = ApiKeyCredentials(_FakeSecrets("tvly-KEY"), "sid")
        self.assertEqual(
            creds.get_access_token("t1", "web"), creds.get_access_token("t2", "web")
        )


class WebConnectorTests(unittest.TestCase):
    def _web_shim(self):
        from homebase_connectors.identity import ApiKeyCredentials

        sent = []

        def transport(method, url, headers, body):
            sent.append((method, url, headers, body))
            return {"ok": True}

        creds = ApiKeyCredentials(_FakeSecrets("tvly-KEY"), "sid")
        shim = ConnectorShim("web", creds, make_api(transport))
        return shim, sent

    def test_web_search_hits_pinned_tavily_host(self):
        shim, sent = self._web_shim()
        out = shim.call("t1", "web.search", {"query": "latest news", "max_results": 50})
        self.assertEqual(out, {"ok": True})
        method, url, headers, body = sent[0]
        self.assertEqual(method, "POST")
        self.assertEqual(url, "https://api.tavily.com/search")
        self.assertIn("Bearer tvly-KEY", headers["Authorization"])
        import json as _json

        payload = _json.loads(body)
        self.assertEqual(payload["query"], "latest news")
        self.assertEqual(payload["max_results"], 10)  # capped from 50 to the ceiling

    def test_web_fetch_uses_extract_and_caps_urls(self):
        shim, sent = self._web_shim()
        urls = [f"https://example.com/{i}" for i in range(9)]
        shim.call("t1", "web.fetch", {"urls": urls})
        method, url, _headers, body = sent[0]
        self.assertEqual(url, "https://api.tavily.com/extract")
        import json as _json

        self.assertEqual(len(_json.loads(body)["urls"]), 5)  # capped at 5

    def test_no_oauth_status_is_connected(self):
        shim, _sent = self._web_shim()
        self.assertEqual(shim.status("t1"), {"connector": "web", "status": "connected"})


class BuildShimTests(unittest.TestCase):
    def test_injected_credentials_bypass_aws(self):
        # build_shim accepts an injected credentials object, so no boto3/AWS is needed
        # to exercise the API-key connector path.
        from homebase_connectors.handler import build_shim
        from homebase_connectors.identity import ApiKeyCredentials

        creds = ApiKeyCredentials(_FakeSecrets("tvly-KEY"), "sid")

        sent = []

        def transport(method, url, headers, body):
            sent.append(url)
            return {"results": []}

        shim = build_shim("web", api=make_api(transport), credentials=creds)
        shim.call("t1", "web.search", {"query": "q"})
        self.assertEqual(sent, ["https://api.tavily.com/search"])


if __name__ == "__main__":
    unittest.main()
