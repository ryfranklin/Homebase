"""Offline test for the CLI's invocation contract. No AWS calls."""

import json
import unittest

from homebase_cli.client import AgentClient, new_session_id


class _Body:
    def __init__(self, data: bytes):
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakeRuntime:
    def __init__(self, result: dict):
        self._result = result
        self.calls: list[dict] = []

    def invoke_agent_runtime(self, **kwargs):
        self.calls.append(kwargs)
        return {"response": _Body(json.dumps(self._result).encode("utf-8"))}


class AgentClientTest(unittest.TestCase):
    def test_ask_presents_identity_and_parses_result(self):
        fake = _FakeRuntime({"answer": "hi", "grounded": True, "citations": []})
        client = AgentClient(
            "arn:aws:bedrock-agentcore:us-east-1:000000000000:runtime/x",
            "u1",
            "t1",
            client=fake,
        )
        sid = new_session_id()

        result = client.ask("hello", session_id=sid)

        self.assertEqual(result["answer"], "hi")
        sent = fake.calls[0]
        self.assertEqual(sent["runtimeSessionId"], sid)
        self.assertEqual(sent["accept"], "application/json")
        payload = json.loads(sent["payload"])
        self.assertEqual(payload, {"input": "hello", "session_id": sid, "user_id": "u1", "tenant_id": "t1"})

    def test_session_id_is_long_enough(self):
        # AgentCore requires runtimeSessionId >= 33 chars.
        self.assertGreaterEqual(len(new_session_id()), 33)


if __name__ == "__main__":
    unittest.main()
