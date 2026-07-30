import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_ingestion.bedrock_trigger import (
    BedrockIngestionTrigger,
    IngestionJobError,
    make_client_token,
)
from homebase_ingestion.trigger import IngestionTriggerRequest


class FakeBedrockClient:
    def __init__(self):
        self.calls = []

    def start_ingestion_job(self, **kwargs):
        self.calls.append(kwargs)
        return {"ingestionJob": {"ingestionJobId": "job-123", "status": "STARTING"}}


class FailingBedrockClient:
    def start_ingestion_job(self, **kwargs):
        raise RuntimeError("throttled")


class BedrockTriggerTests(unittest.TestCase):
    def test_starts_job_and_passes_idempotency_token(self):
        client = FakeBedrockClient()
        trigger = BedrockIngestionTrigger(client)
        request = IngestionTriggerRequest(
            knowledge_base_id="KB1",
            data_source_id="DS1",
            changed_count=2,
            client_token="homebase-token",
            description="homebase corpus sync",
        )

        response = trigger.start(request)

        self.assertTrue(response.started)
        self.assertEqual(response.job_id, "job-123")
        self.assertEqual(response.detail, "STARTING")
        self.assertEqual(len(client.calls), 1)
        call = client.calls[0]
        self.assertEqual(call["knowledgeBaseId"], "KB1")
        self.assertEqual(call["dataSourceId"], "DS1")
        self.assertEqual(call["clientToken"], "homebase-token")
        self.assertEqual(call["description"], "homebase corpus sync")

    def test_failure_surfaces_as_error(self):
        trigger = BedrockIngestionTrigger(FailingBedrockClient())
        request = IngestionTriggerRequest(knowledge_base_id="KB1", data_source_id="DS1")
        with self.assertRaises(IngestionJobError):
            trigger.start(request)


class ClientTokenTests(unittest.TestCase):
    def test_token_is_deterministic_and_order_independent(self):
        a = make_client_token(["a.md", "b.md"])
        b = make_client_token(["b.md", "a.md"])
        self.assertEqual(a, b)

    def test_token_differs_for_different_change_sets(self):
        self.assertNotEqual(make_client_token(["a.md"]), make_client_token(["a.md", "b.md"]))

    def test_token_meets_bedrock_minimum_length(self):
        # Bedrock requires clientToken length >= 33.
        self.assertGreaterEqual(len(make_client_token(["a.md"])), 33)


if __name__ == "__main__":
    unittest.main()
