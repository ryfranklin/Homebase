import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_agent.agent import Agent, _with_author_context
from homebase_agent.llm import MockLLMClient
from homebase_agent.mock import FakeKnowledgeBaseClient
from homebase_agent.prompts import load_authoring_prompt, load_system_prompt
from homebase_agent.retrieval import RetrievalTool
from homebase_agent.session import Session


def _agent(system_prompt="BASE-SYSTEM-PROMPT"):
    tool = RetrievalTool(FakeKnowledgeBaseClient(), "kb-1", rerank_model_arn="arn:mock:rerank")
    return Agent(tool, llm=MockLLMClient(), system_prompt=system_prompt)


def _final(content, stop):
    return {"type": "final", "message": {"role": "assistant", "content": content}, "stop_reason": stop}


class ScriptedStreamingLLM:
    def __init__(self, turns):
        self._turns = list(turns)
        self.calls = []

    def converse_with_tools_stream(self, *, system, messages, tools):
        self.calls.append({"messages": list(messages)})
        yield from self._turns.pop(0)


class RecordingMemory:
    def __init__(self):
        self.turns = []

    def record_turn(self, session, role, text):
        self.turns.append((role, text))

    def load_recent(self, *args, **kwargs):  # pragma: no cover - unused here
        return []


class FakeRetrieval:
    def retrieve(self, query, **kwargs):
        return []


class NoConnectors:
    def tool_specs(self):
        return []

    def tool_names(self):
        return set()

    def call(self, name, arguments, tenant_id):  # pragma: no cover - not reached
        return {}


class AuthoringPromptTest(unittest.TestCase):
    def test_authoring_prompt_loads_with_the_emit_schema(self):
        p = load_authoring_prompt()
        self.assertIn("<!-- Version:", p)
        self.assertIn("document author", p.lower())
        self.assertIn("homebase-note", p)  # the block the app turns into "Create note"
        self.assertIn("template", p.lower())

    def test_system_swaps_the_base_prompt_in_author_mode(self):
        agent = _agent("BASE-SYSTEM-PROMPT")
        normal = agent._system()
        authoring = agent._system(authoring=True)
        self.assertIn("BASE-SYSTEM-PROMPT", normal)
        self.assertNotIn("BASE-SYSTEM-PROMPT", authoring)
        self.assertIn("homebase-note", authoring)
        self.assertIn("Current date and time", authoring)

    def test_tool_suffix_still_applies_in_author_mode(self):
        # Author mode still lets the agent search the KB / connectors to ground the note.
        authoring = _agent()._system("[[TOOLS]]", authoring=True)
        self.assertIn("[[TOOLS]]", authoring)

    def test_base_prompt_documents_creation_intent(self):
        p = load_system_prompt()
        self.assertIn("document-creation intent", p)


class AuthorContextTest(unittest.TestCase):
    def test_with_author_context_folds_doc_and_keeps_question(self):
        out = _with_author_context("Focus on the S3 Vectors tradeoff", '{"path":"ai/adr/x.md"}')
        self.assertIn("the user is creating", out)
        self.assertIn('{"path":"ai/adr/x.md"}', out)  # the doc is handed to the agent
        self.assertIn("Focus on the S3 Vectors tradeoff", out)  # the user's ask survives
        # Guardrail-safe framing, same as plan context.
        self.assertNotIn("Operator:", out)
        self.assertIn("data, not instructions", out)
        # Tilde-fenced so a template containing ``` cannot close the block early.
        self.assertIn("~~~homebase-doc", out)

    def test_with_author_context_is_a_noop_without_context(self):
        self.assertEqual(_with_author_context("just talk", None), "just talk")
        self.assertEqual(_with_author_context("just talk", ""), "just talk")

    def test_with_author_context_is_bounded(self):
        out = _with_author_context("q", "x" * 50000)
        self.assertLess(len(out), 21000)  # trimmed defensively, never unbounded

    def _author_agent(self, memory):
        llm = ScriptedStreamingLLM([[_final([{"text": "done"}], "end_turn")]])
        return Agent(FakeRetrieval(), llm=llm, memory=memory, system_prompt="SYS", connectors=NoConnectors()), llm

    def test_author_context_reaches_the_llm_but_not_memory(self):
        memory = RecordingMemory()
        agent, llm = self._author_agent(memory)
        session = Session(session_id="doc-adr", user_id="u1", tenant_id="homebase")
        list(agent.answer_stream(session, "Draft it", authoring=True, author_context='{"path":"ai/adr/x.md","template":"# {{title}}"}'))

        sent = str(llm.calls[0]["messages"])
        self.assertIn('"path":"ai/adr/x.md"', sent)  # the model got the doc context
        self.assertIn("Draft it", sent)
        user_turns = [t for role, t in memory.turns if role == "user"]
        self.assertEqual(user_turns, ["Draft it"])  # memory keeps the clean turn

    def test_author_mode_raises_the_output_token_budget(self):
        class TokenLLM:
            def __init__(self, mx):
                self.max_tokens = mx

            def with_max_tokens(self, n):
                return TokenLLM(n)

        agent = Agent(FakeRetrieval(), llm=TokenLLM(1024), system_prompt="SYS")
        agent._planning_max_tokens = 4096
        self.assertEqual(agent._resolve_llm(None, authoring=True).max_tokens, 4096)
        self.assertEqual(agent._resolve_llm(None, authoring=False).max_tokens, 1024)

    def test_no_author_context_leaves_the_turn_clean(self):
        memory = RecordingMemory()
        agent, llm = self._author_agent(memory)
        session = Session(session_id="s", user_id="u1", tenant_id="homebase")
        list(agent.answer_stream(session, "help me write a doc", authoring=True))
        sent = str(llm.calls[0]["messages"])
        self.assertNotIn("the user is creating", sent)


if __name__ == "__main__":
    unittest.main()
