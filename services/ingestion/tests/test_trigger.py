import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_ingestion.sync import SyncResult
from homebase_ingestion.trigger import (
    IngestionTriggerRequest,
    NullIngestionTrigger,
    should_trigger,
)


class TriggerContractTests(unittest.TestCase):
    def test_null_trigger_records_and_starts_nothing(self):
        trigger = NullIngestionTrigger()
        request = IngestionTriggerRequest(
            knowledge_base_id="KB_PLACEHOLDER",
            data_source_id="DS_PLACEHOLDER",
            changed_count=3,
            client_token="token-123",
        )
        response = trigger.start(request)

        self.assertFalse(response.started)
        self.assertIsNone(response.job_id)
        self.assertEqual(trigger.requests, [request])

    def test_should_trigger_only_when_corpus_changed(self):
        self.assertFalse(should_trigger(SyncResult()))
        self.assertFalse(should_trigger(SyncResult(skipped=["a.md"])))
        self.assertTrue(should_trigger(SyncResult(uploaded=["a.md"])))
        self.assertTrue(should_trigger(SyncResult(pruned=["b.md"])))


if __name__ == "__main__":
    unittest.main()
