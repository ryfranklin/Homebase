import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_agent.llm import BedrockLLMClient


class _FakeConverseClient:
    def __init__(self):
        self.calls = []

    def converse(self, **kw):
        self.calls.append(kw)
        return {"output": {"message": {"content": [{"text": "ok"}]}}, "stopReason": "end_turn"}

    def converse_stream(self, **kw):
        self.calls.append(kw)
        return {"stream": []}


GUARDRAIL = {"guardrailIdentifier": "gr-1", "guardrailVersion": "1"}


class GuardrailWiringTest(unittest.TestCase):
    def test_guardrail_config_passed_to_every_converse_call_when_set(self):
        c = _FakeConverseClient()
        llm = BedrockLLMClient(c, "model", guardrail=GUARDRAIL)
        llm.generate(system="s", question="q", passages=[], session=None)
        llm.converse_with_tools(system="s", messages=[], tools=[])
        list(llm.converse_with_tools_stream(system="s", messages=[], tools=[]))
        self.assertEqual(len(c.calls), 3)
        for call in c.calls:
            self.assertEqual(call["guardrailConfig"], GUARDRAIL)

    def test_no_guardrail_config_when_unset(self):
        c = _FakeConverseClient()
        llm = BedrockLLMClient(c, "model")  # no guardrail
        llm.converse_with_tools(system="s", messages=[], tools=[])
        self.assertNotIn("guardrailConfig", c.calls[0])


if __name__ == "__main__":
    unittest.main()
