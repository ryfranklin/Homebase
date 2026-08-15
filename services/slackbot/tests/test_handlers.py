"""Offline tests for the bridge decision logic: gating, formatting, identity."""

import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_slackbot.agent_client import AgentReply, session_id_for
from homebase_slackbot.handlers import Deps, clean_prompt, format_reply, handle_question


class _FakeAllowlist:
    def __init__(self, allowed):
        self._allowed = set(allowed)

    def allows(self, email):
        return email in self._allowed


class _FakeAgent:
    def __init__(self, reply):
        self.reply = reply
        self.calls = []

    def ask(self, prompt, *, user_id, session_id):
        self.calls.append({"prompt": prompt, "user_id": user_id, "session_id": session_id})
        return self.reply


def _deps(*, email="me@example.com", allowed=("me@example.com",), reply=None):
    return Deps(
        resolve_email=lambda uid: email,
        allowlist=_FakeAllowlist(allowed),
        agent=_FakeAgent(reply or AgentReply(answer="the answer")),
        session_id_for=session_id_for,
    )


class CleanPromptTest(unittest.TestCase):
    def test_strips_leading_mention(self):
        self.assertEqual(clean_prompt("<@U12345> what is up"), "what is up")

    def test_plain_text_unchanged(self):
        self.assertEqual(clean_prompt("  hello  "), "hello")


class FormatReplyTest(unittest.TestCase):
    def test_authorization_url_takes_priority(self):
        out = format_reply(AgentReply(answer="", authorization_url="https://x/auth"))
        self.assertIn("https://x/auth", out)
        self.assertIn("authorize", out.lower())

    def test_appends_deduped_sources(self):
        reply = AgentReply(
            answer="hi",
            citations=[
                {"source_path": "a.md"},
                {"source_path": "a.md"},
                {"source_path": "b.md"},
            ],
        )
        out = format_reply(reply)
        self.assertIn("*Sources*", out)
        self.assertEqual(out.count("a.md"), 1)
        self.assertIn("b.md", out)

    def test_ungrounded_note_when_no_citations(self):
        out = format_reply(AgentReply(answer="dunno", grounded=False, citations=[]))
        self.assertIn("no relevant source", out.lower())


class HandleQuestionTest(unittest.TestCase):
    def test_happy_path_presents_email_identity(self):
        deps = _deps()
        out = handle_question(text="<@U1> hello", slack_user_id="U1", channel="C1", thread="T1", deps=deps)
        self.assertEqual(out, "the answer")
        call = deps.agent.calls[0]
        self.assertEqual(call["user_id"], "me@example.com")
        self.assertEqual(call["prompt"], "hello")
        self.assertEqual(call["session_id"], session_id_for("C1", "T1"))

    def test_empty_prompt_short_circuits(self):
        deps = _deps()
        out = handle_question(text="<@U1>   ", slack_user_id="U1", channel="C1", thread="T1", deps=deps)
        self.assertIn("Ask me something", out)
        self.assertEqual(deps.agent.calls, [])

    def test_no_email_denied(self):
        deps = _deps(email=None)
        out = handle_question(text="<@U1> hi", slack_user_id="U1", channel="C1", thread="T1", deps=deps)
        self.assertIn("could not read a verified email", out)
        self.assertEqual(deps.agent.calls, [])

    def test_not_allowlisted_denied(self):
        deps = _deps(email="stranger@example.com", allowed=("me@example.com",))
        out = handle_question(text="<@U1> hi", slack_user_id="U1", channel="C1", thread="T1", deps=deps)
        self.assertIn("allow-list", out.lower())
        self.assertEqual(deps.agent.calls, [])


if __name__ == "__main__":
    unittest.main()
