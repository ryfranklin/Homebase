import io
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_cli.chat import converse_once, main
from homebase_cli.render import render_stream
from homebase_cli.session import Session


class RenderTests(unittest.TestCase):
    def test_renders_tokens_and_citations(self):
        out = io.StringIO()
        events = [
            {"type": "token", "text": "Rotate "},
            {"type": "token", "text": "the key."},
            {"type": "citation", "source_path": "ops/key-rotation.md"},
            {"type": "citation", "source_path": "ops/key-rotation.md"},
            {"type": "done"},
        ]
        grounded = render_stream(iter(events), out)
        text = out.getvalue()
        self.assertIn("Rotate the key.", text)
        self.assertIn("sources:", text)
        self.assertIn("ops/key-rotation.md", text)
        self.assertEqual(text.count("ops/key-rotation.md"), 1)  # deduped
        self.assertTrue(grounded)

    def test_no_sources_not_grounded(self):
        out = io.StringIO()
        events = [{"type": "token", "text": "I have no relevant source."}, {"type": "done"}]
        grounded = render_stream(iter(events), out)
        self.assertFalse(grounded)
        self.assertNotIn("sources:", out.getvalue())


class FakeClient:
    def __init__(self, events):
        self._events = events
        self.calls = []

    def stream(self, session, prompt):
        self.calls.append((session, prompt))
        return iter(self._events)


class ChatMainTests(unittest.TestCase):
    def test_one_shot_uses_config_identity(self):
        client = FakeClient([{"type": "token", "text": "hi"}, {"type": "citation", "source_path": "a.md"}, {"type": "done"}])
        out = io.StringIO()
        env = {
            "HOMEBASE_AGENT_RUNTIME_ARN": "arn:aws:bedrock-agentcore:region:acct:runtime/example",
            "HOMEBASE_USER_ID": "user-9",
            "HOMEBASE_TENANT_ID": "tenant-9",
        }
        rc = main(["--prompt", "hello"], client=client, out=out, env=env)
        self.assertEqual(rc, 0)
        session, prompt = client.calls[0]
        self.assertEqual(prompt, "hello")
        self.assertEqual(session.tenant_id, "tenant-9")
        self.assertEqual(session.user_id, "user-9")
        self.assertIn("a.md", out.getvalue())

    def test_missing_env_exits(self):
        with self.assertRaises(SystemExit):
            main(["--prompt", "hi"], client=FakeClient([]), out=io.StringIO(), env={})

    def test_converse_once_returns_grounded(self):
        client = FakeClient([{"type": "citation", "source_path": "a.md"}, {"type": "done"}])
        session = Session(session_id="s", user_id="u", tenant_id="t")
        self.assertTrue(converse_once(client, session, "q", io.StringIO()))


if __name__ == "__main__":
    unittest.main()
