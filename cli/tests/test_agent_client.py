import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_cli.agent_client import AgentRuntimeClient, parse_sse
from homebase_cli.session import Session


class ParseSseTests(unittest.TestCase):
    def test_parses_events_split_across_chunks(self):
        chunks = [
            b'data: {"type":"token","text":"Hel"}\n\n',
            b'data: {"type":"token","text":"lo"}\n\ndata: {"type":"citation","source_path":"ops/x.md"}\n\n',
            b'data: {"type":"done"}\n\n',
        ]
        events = list(parse_sse(chunks))
        self.assertEqual(
            events,
            [
                {"type": "token", "text": "Hel"},
                {"type": "token", "text": "lo"},
                {"type": "citation", "source_path": "ops/x.md"},
                {"type": "done"},
            ],
        )

    def test_non_json_data_becomes_token(self):
        self.assertEqual(list(parse_sse([b"data: hello world\n\n"])), [{"type": "token", "text": "hello world"}])


class FakeLowLevelClient:
    """Stands in for the boto3 bedrock-agentcore client."""

    def __init__(self, chunks):
        self._chunks = chunks
        self.calls = []

    def invoke_agent_runtime(self, **kwargs):
        self.calls.append(kwargs)
        return {"response": iter(self._chunks)}


class AgentRuntimeClientTests(unittest.TestCase):
    def test_stream_invokes_with_identity_and_yields_events(self):
        fake = FakeLowLevelClient([b'data: {"type":"token","text":"hi"}\n\n', b'data: {"type":"done"}\n\n'])
        client = AgentRuntimeClient(fake, "arn:aws:bedrock-agentcore:region:acct:runtime/example")
        session = Session(session_id="s1", user_id="u1", tenant_id="t1")

        events = list(client.stream(session, "hello"))

        self.assertEqual(events[0], {"type": "token", "text": "hi"})
        call = fake.calls[0]
        self.assertEqual(call["runtimeSessionId"], "s1")
        # Identity is passed in the payload so tenant scoping matches the GUI.
        import json

        payload = json.loads(call["payload"])
        self.assertEqual(payload["user_id"], "u1")
        self.assertEqual(payload["tenant_id"], "t1")


if __name__ == "__main__":
    unittest.main()
