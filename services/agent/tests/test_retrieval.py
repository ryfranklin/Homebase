import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_agent.mock import FakeKnowledgeBaseClient
from homebase_agent.retrieval import RetrievalTool, build_filter


class BuildFilterTests(unittest.TestCase):
    def test_no_filter(self):
        self.assertIsNone(build_filter())

    def test_single_tag_clause(self):
        self.assertEqual(build_filter(tag="ops"), {"equals": {"key": "fm-tags", "value": "ops"}})

    def test_tag_and_recency_combined(self):
        f = build_filter(tag="ops", updated_after="2026-01-01")
        self.assertIn("andAll", f)
        self.assertEqual(len(f["andAll"]), 2)


class RetrievalToolTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeKnowledgeBaseClient()
        self.tool = RetrievalTool(self.client, "kb-1", rerank_model_arn="arn:mock:rerank")

    def test_over_retrieves_and_reranks(self):
        self.tool.retrieve("how to rotate the key", over_retrieve=25, top_k=3)
        cfg = self.client.calls[0]["retrievalConfiguration"]["vectorSearchConfiguration"]
        # Rung 1: wide candidate set. Rung 2: rerank requested.
        self.assertEqual(cfg["numberOfResults"], 25)
        self.assertEqual(cfg["overrideSearchType"], "SEMANTIC")
        self.assertIn("rerankingConfiguration", cfg)

    def test_returns_passages_with_source_paths(self):
        passages = self.tool.retrieve("warranty", top_k=5)
        self.assertTrue(passages)
        self.assertEqual(passages[0].source_path, "products/r200-warranty.md")
        self.assertTrue(passages[0].text)

    def test_top_k_caps_results(self):
        passages = self.tool.retrieve("key", top_k=1)
        self.assertEqual(len(passages), 1)

    def test_folder_filter_is_client_side_prefix(self):
        # "key" returns ops/* and (via canned data) only ops/ sources.
        passages = self.tool.retrieve("key", folder="ops", top_k=5)
        self.assertTrue(all(p.source_path.startswith("ops/") for p in passages))
        # Filtering to a folder with no matches yields nothing.
        self.assertEqual(self.tool.retrieve("key", folder="hr", top_k=5), [])

    def test_off_topic_returns_empty(self):
        self.assertEqual(self.tool.retrieve("unrelated question", top_k=5), [])


if __name__ == "__main__":
    unittest.main()
