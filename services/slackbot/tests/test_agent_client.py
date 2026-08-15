"""Offline tests for the agent client: identity, SSE assembly, JSON fallback."""

import json
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_slackbot.agent_client import AgentClient, parse_response, session_id_for


class _Body:
    def __init__(self, data: bytes):
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakeRuntime:
    def __init__(self, body: bytes, content_type=None):
        self._body = body
        self._content_type = content_type
        self.calls: list[dict] = []

    def invoke_agent_runtime(self, **kwargs):
        self.calls.append(kwargs)
        resp = {"response": _Body(self._body)}
        if self._content_type:
            resp["contentType"] = self._content_type
        return resp


def _sse(*events: dict) -> bytes:
    return "".join(f"data: {json.dumps(e)}\n\n" for e in events).encode("utf-8")


class SessionIdTest(unittest.TestCase):
    def test_stable_and_long_enough(self):
        a = session_id_for("C1", "1700000000.1")
        b = session_id_for("C1", "1700000000.1")
        self.assertEqual(a, b)
        self.assertGreaterEqual(len(a), 33)

    def test_thread_defaults_to_channel(self):
        self.assertEqual(session_id_for("C1", None), session_id_for("C1", "C1"))


class ParseResponseTest(unittest.TestCase):
    def test_parses_sse_stream_by_content_type(self):
        body = _sse(
            {"type": "token", "text": "Hello "},
            {"type": "token", "text": "world"},
            {"type": "citation", "source_path": "notes/a.md", "score": 0.9},
            {"type": "done"},
        )
        reply = parse_response(body, "text/event-stream")
        self.assertEqual(reply.answer, "Hello world")
        self.assertEqual(reply.citations[0]["source_path"], "notes/a.md")

    def test_sniffs_sse_without_content_type(self):
        body = _sse({"type": "token", "text": "hi"}, {"type": "done"})
        reply = parse_response(body, None)
        self.assertEqual(reply.answer, "hi")

    def test_parses_json_object(self):
        body = json.dumps({"answer": "buffered", "grounded": False, "citations": []}).encode()
        reply = parse_response(body, "application/json")
        self.assertEqual(reply.answer, "buffered")
        self.assertFalse(reply.grounded)

    def test_sse_authorization_required(self):
        body = _sse({"type": "authorization_required", "authorization_url": "https://x/auth"}, {"type": "done"})
        reply = parse_response(body, "text/event-stream")
        self.assertEqual(reply.authorization_url, "https://x/auth")


class AgentClientTest(unittest.TestCase):
    def test_ask_presents_identity_and_session(self):
        fake = _FakeRuntime(_sse({"type": "token", "text": "ok"}, {"type": "done"}), "text/event-stream")
        client = AgentClient("arn:aws:bedrock-agentcore:...:runtime/x", "homebase", client=fake)
        reply = client.ask("q", user_id="me@example.com", session_id="homebase-slack-abc" + "x" * 30)
        self.assertEqual(reply.answer, "ok")
        sent = json.loads(fake.calls[0]["payload"])
        self.assertEqual(sent["user_id"], "me@example.com")
        self.assertEqual(sent["tenant_id"], "homebase")
        self.assertEqual(fake.calls[0]["runtimeSessionId"], "homebase-slack-abc" + "x" * 30)


if __name__ == "__main__":
    unittest.main()
