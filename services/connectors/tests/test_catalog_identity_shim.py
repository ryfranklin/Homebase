import pathlib
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_connectors.catalog import CONNECTORS, READ, WRITE, TOOLS, read_scopes_for, write_tools
from homebase_connectors.gate import is_confirmation
from homebase_connectors.identity import ConnectorCredentials, tenant_namespaced_key
from homebase_connectors.shim import ConnectorShim

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"


class CatalogTests(unittest.TestCase):
    def test_all_connectors_present(self):
        self.assertEqual(set(CONNECTORS), {t.connector for t in TOOLS.values()})
        self.assertEqual(len(CONNECTORS), 7)

    def test_read_first_every_connector_has_a_read_tool(self):
        for connector in CONNECTORS:
            self.assertTrue(read_scopes_for(connector), f"{connector} lacks a read tool/scope")

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


if __name__ == "__main__":
    unittest.main()
