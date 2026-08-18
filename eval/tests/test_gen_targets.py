"""Offline tests for targets. The live Converse target is exercised with a fake
boto3 client, so no AWS is touched. unittest.TestCase style for CI's discover."""

from __future__ import annotations

import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_eval.gen_models import GenCase
from homebase_eval.targets import BedrockConverseTarget, MockModelTarget


class _FakeConverseClient:
    """Records the request and returns a canned Converse response."""

    def __init__(self):
        self.last_request = None

    def converse(self, **kwargs):
        self.last_request = kwargs
        return {
            "output": {"message": {"content": [{"text": "hi "}, {"text": "there"}]}},
            "usage": {"inputTokens": 11, "outputTokens": 7},
        }


class _BoomClient:
    def converse(self, **kwargs):
        raise RuntimeError("ThrottlingException")


def _fake_clock():
    # Two ticks 0.5s apart, so latency computes to 500ms.
    ticks = iter([1.0, 1.5])
    return lambda: next(ticks)


class MockTargetTests(unittest.TestCase):
    def test_deterministic(self):
        t = MockModelTarget("m", responder=lambda c: f"answer to {c.prompt}", latency_ms=12.0)
        r = t.generate(GenCase(id="c", prompt="hello"))
        self.assertTrue(r.ok)
        self.assertEqual(r.text, "answer to hello")
        self.assertEqual(r.latency_ms, 12.0)

    def test_failure_mode(self):
        t = MockModelTarget("m", ok=False, error="access denied")
        r = t.generate(GenCase(id="c", prompt="hi"))
        self.assertFalse(r.ok)
        self.assertEqual(r.error, "access denied")


class ConverseTargetTests(unittest.TestCase):
    def test_builds_request_and_parses_usage(self):
        client = _FakeConverseClient()
        target = BedrockConverseTarget(client, "zai.glm-5", max_tokens=256, temperature=0.0, clock=_fake_clock())
        r = target.generate(GenCase(id="c", prompt="say hi", system="be terse"))

        req = client.last_request
        self.assertEqual(req["modelId"], "zai.glm-5")
        self.assertEqual(req["messages"], [{"role": "user", "content": [{"text": "say hi"}]}])
        self.assertEqual(req["system"], [{"text": "be terse"}])
        self.assertEqual(req["inferenceConfig"], {"maxTokens": 256, "temperature": 0.0})

        self.assertEqual(r.text, "hi there")
        self.assertEqual(r.input_tokens, 11)
        self.assertEqual(r.output_tokens, 7)
        self.assertEqual(r.latency_ms, 500.0)
        self.assertTrue(r.ok)

    def test_no_system_block_when_absent(self):
        client = _FakeConverseClient()
        target = BedrockConverseTarget(client, "m", clock=_fake_clock())
        target.generate(GenCase(id="c", prompt="hi"))
        self.assertNotIn("system", client.last_request)

    def test_error_is_scored_miss_not_crash(self):
        target = BedrockConverseTarget(_BoomClient(), "m", clock=_fake_clock())
        r = target.generate(GenCase(id="c", prompt="hi"))
        self.assertFalse(r.ok)
        self.assertIn("ThrottlingException", r.error)
        self.assertEqual(r.latency_ms, 500.0)


if __name__ == "__main__":
    unittest.main()
