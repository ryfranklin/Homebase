import unittest

import _bootstrap  # noqa: F401

from homebase_agent.agent import Agent
from homebase_agent.retrieval import Passage
from homebase_agent.session import Session

SYS = "test system prompt"
SESSION = Session(session_id="s1", user_id="u1", tenant_id="homebase")


def tool_use(name, tool_input, tool_use_id="t1"):
    return {
        "message": {"role": "assistant", "content": [{"toolUse": {"toolUseId": tool_use_id, "name": name, "input": tool_input}}]},
        "stop_reason": "tool_use",
    }


def final(text):
    return {"message": {"role": "assistant", "content": [{"text": text}]}, "stop_reason": "end_turn"}


class ScriptedLLM:
    """Returns pre-scripted converse turns; records what it was asked."""

    def __init__(self, turns):
        self._turns = list(turns)
        self.calls = []

    def converse_with_tools(self, *, system, messages, tools):
        self.calls.append({"system": system, "messages": messages, "tools": tools})
        return self._turns.pop(0)


class FakeRetrieval:
    def __init__(self, passages):
        self._passages = passages

    def retrieve(self, query, **kwargs):
        return self._passages


class FakeConnectors:
    def __init__(self, response):
        self._response = response
        self.calls = []

    def tool_specs(self):
        return [
            {"toolSpec": {"name": "slack_read_messages", "description": "x", "inputSchema": {"json": {"type": "object"}}}},
            {"toolSpec": {"name": "gmail_search_messages", "description": "x", "inputSchema": {"json": {"type": "object"}}}},
        ]

    def tool_names(self):
        return {"slack_read_messages", "gmail_search_messages"}

    def call(self, name, arguments, tenant_id):
        self.calls.append((name, arguments, tenant_id))
        return self._response


def _agent(llm, connectors, passages=None):
    return Agent(FakeRetrieval(passages or []), llm=llm, system_prompt=SYS, connectors=connectors)


class AgentToolLoopTests(unittest.TestCase):
    def test_connector_tool_answers_and_passes_tenant(self):
        llm = ScriptedLLM([
            tool_use("slack_read_messages", {"channel": "general"}),
            final("Here is what was discussed in general."),
        ])
        connectors = FakeConnectors({"requires_confirmation": False, "result": {"messages": [{"text": "hi"}]}})
        agent = _agent(llm, connectors)

        result = agent.answer(SESSION, "what's in #general?")

        self.assertEqual(result.text, "Here is what was discussed in general.")
        self.assertFalse(result.grounded)
        self.assertEqual(result.citations, [])
        self.assertIsNone(result.authorization_url)
        # The shim was called with the session tenant.
        self.assertEqual(connectors.calls[0], ("slack_read_messages", {"channel": "general"}, "homebase"))

    def test_knowledge_base_tool_grounds_and_cites(self):
        llm = ScriptedLLM([
            tool_use("search_knowledge_base", {"query": "key rotation"}),
            final("Rotate the key via the runbook."),
        ])
        passages = [Passage(text="steps...", source_path="ops/key-rotation.md", score=0.9)]
        agent = _agent(llm, FakeConnectors({}), passages=passages)

        result = agent.answer(SESSION, "how do I rotate the key?")

        self.assertTrue(result.grounded)
        self.assertEqual(len(result.citations), 1)
        self.assertEqual(result.citations[0].source_path, "ops/key-rotation.md")

    def test_requires_authorization_surfaces_consent_url(self):
        llm = ScriptedLLM([
            tool_use("gmail_search_messages", {"query": "invoices"}),
            # No second turn needed: the loop short-circuits on authorization.
        ])
        connectors = FakeConnectors({"requires_authorization": True, "authorization_url": "https://consent.example/authorize"})
        agent = _agent(llm, connectors)

        result = agent.answer(SESSION, "search my email for invoices")

        self.assertEqual(result.authorization_url, "https://consent.example/authorize")
        self.assertIn("https://consent.example/authorize", result.text)
        self.assertFalse(result.grounded)
        self.assertEqual(len(llm.calls), 1)  # stopped after the first tool call

    def test_no_tool_returns_direct_answer(self):
        llm = ScriptedLLM([final("Hello, how can I help?")])
        agent = _agent(llm, FakeConnectors({}))

        result = agent.answer(SESSION, "hi")

        self.assertEqual(result.text, "Hello, how can I help?")
        self.assertFalse(result.grounded)

    def test_tools_offered_include_kb_and_connectors(self):
        llm = ScriptedLLM([final("ok")])
        agent = _agent(llm, FakeConnectors({}))
        agent.answer(SESSION, "hi")
        offered = {t["toolSpec"]["name"] for t in llm.calls[0]["tools"]}
        self.assertIn("search_knowledge_base", offered)
        self.assertIn("slack_read_messages", offered)


if __name__ == "__main__":
    unittest.main()
