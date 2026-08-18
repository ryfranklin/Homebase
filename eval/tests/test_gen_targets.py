"""Offline tests for targets. The live Converse target is exercised with a fake
boto3 client, so no AWS is touched."""

from __future__ import annotations

from homebase_eval.gen_models import GenCase
from homebase_eval.targets import BedrockConverseTarget, MockModelTarget


def test_mock_target_deterministic():
    t = MockModelTarget("m", responder=lambda c: f"answer to {c.prompt}", latency_ms=12.0)
    r = t.generate(GenCase(id="c", prompt="hello"))
    assert r.ok and r.text == "answer to hello"
    assert r.latency_ms == 12.0


def test_mock_target_failure_mode():
    t = MockModelTarget("m", ok=False, error="access denied")
    r = t.generate(GenCase(id="c", prompt="hi"))
    assert r.ok is False and r.error == "access denied"


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


def _fake_clock():
    # A monotonic-ish clock: two ticks 0.5s apart, so latency computes to 500ms.
    ticks = iter([1.0, 1.5])
    return lambda: next(ticks)


def test_converse_target_builds_request_and_parses_usage():
    client = _FakeConverseClient()
    target = BedrockConverseTarget(client, "zai.glm-5", max_tokens=256, temperature=0.0, clock=_fake_clock())
    case = GenCase(id="c", prompt="say hi", system="be terse")
    r = target.generate(case)

    # Request shape is model-agnostic Converse.
    req = client.last_request
    assert req["modelId"] == "zai.glm-5"
    assert req["messages"] == [{"role": "user", "content": [{"text": "say hi"}]}]
    assert req["system"] == [{"text": "be terse"}]
    assert req["inferenceConfig"] == {"maxTokens": 256, "temperature": 0.0}

    # Response parsing: concatenated text blocks + usage + measured latency.
    assert r.text == "hi there"
    assert r.input_tokens == 11 and r.output_tokens == 7
    assert r.latency_ms == 500.0
    assert r.ok is True


def test_converse_target_no_system_block_when_absent():
    client = _FakeConverseClient()
    target = BedrockConverseTarget(client, "m", clock=_fake_clock())
    target.generate(GenCase(id="c", prompt="hi"))
    assert "system" not in client.last_request


class _BoomClient:
    def converse(self, **kwargs):
        raise RuntimeError("ThrottlingException")


def test_converse_target_error_is_scored_miss_not_crash():
    target = BedrockConverseTarget(_BoomClient(), "m", clock=_fake_clock())
    r = target.generate(GenCase(id="c", prompt="hi"))
    assert r.ok is False
    assert "ThrottlingException" in r.error
    assert r.latency_ms == 500.0
