import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_agent.agent import NO_SOURCES_MESSAGE, Agent
from homebase_agent.llm import MockLLMClient
from homebase_agent.mock import FakeKnowledgeBaseClient
from homebase_agent.retrieval import RetrievalTool
from homebase_agent.session import Session

SYSTEM_PROMPT = "test system prompt"


def _agent():
    tool = RetrievalTool(FakeKnowledgeBaseClient(), "kb-1", rerank_model_arn="arn:mock:rerank")
    return Agent(tool, llm=MockLLMClient(), system_prompt=SYSTEM_PROMPT)


class RecordingMemory:
    def __init__(self):
        self.turns = []

    def record_turn(self, session, role, text):
        self.turns.append((session.tenant_id, role, text))

    def recall(self, session, query, *, top_k=5):
        return []


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.session = Session(session_id="s1", user_id="u1", tenant_id="t1")

    def test_grounded_answer_carries_citations(self):
        result = _agent().answer(self.session, "How do I rotate the key?")
        self.assertTrue(result.grounded)
        self.assertTrue(result.citations)
        self.assertTrue(all(c.source_path for c in result.citations))
        self.assertIn("ops/key-rotation.md", [c.source_path for c in result.citations])

    def test_no_sources_path_does_not_hallucinate(self):
        result = _agent().answer(self.session, "totally unrelated question")
        self.assertFalse(result.grounded)
        self.assertEqual(result.citations, [])
        self.assertEqual(result.text, NO_SOURCES_MESSAGE)

    def test_tenant_identity_preserved(self):
        result = _agent().answer(self.session, "warranty question")
        self.assertEqual(result.session.tenant_id, "t1")
        self.assertEqual(result.session.user_id, "u1")

    def test_memory_records_turns_with_tenant(self):
        tool = RetrievalTool(FakeKnowledgeBaseClient(), "kb-1", rerank_model_arn="arn:mock:rerank")
        memory = RecordingMemory()
        agent = Agent(tool, llm=MockLLMClient(), memory=memory, system_prompt=SYSTEM_PROMPT)
        agent.answer(self.session, "warranty question")
        self.assertEqual(memory.turns[0][0], "t1")  # tenant threaded into memory
        self.assertIn("user", [t[1] for t in memory.turns])
        self.assertIn("assistant", [t[1] for t in memory.turns])


if __name__ == "__main__":
    unittest.main()
