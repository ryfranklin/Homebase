import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_agent.agent import Agent, _with_plan_context
from homebase_agent.llm import MockLLMClient
from homebase_agent.mock import FakeKnowledgeBaseClient
from homebase_agent.prompts import load_planning_prompt
from homebase_agent.retrieval import RetrievalTool
from homebase_agent.session import Session


def _agent(system_prompt="BASE-SYSTEM-PROMPT"):
    tool = RetrievalTool(FakeKnowledgeBaseClient(), "kb-1", rerank_model_arn="arn:mock:rerank")
    return Agent(tool, llm=MockLLMClient(), system_prompt=system_prompt)


# --- revise-mode plan context ------------------------------------------------
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


class PlanningPromptTest(unittest.TestCase):
    def test_planning_prompt_loads_with_the_emit_schema(self):
        p = load_planning_prompt()
        self.assertIn("<!-- Version:", p)
        self.assertIn("INCEPTION", p)
        self.assertIn("homebase-plan-draft", p)  # the block the app persists
        self.assertIn("CONSTRUCTION", p)

    def test_system_swaps_the_base_prompt_in_plan_mode(self):
        agent = _agent("BASE-SYSTEM-PROMPT")
        normal = agent._system()
        planning = agent._system(planning=True)
        # Normal mode carries the base prompt; plan mode carries the AI-DLC prompt.
        self.assertIn("BASE-SYSTEM-PROMPT", normal)
        self.assertNotIn("BASE-SYSTEM-PROMPT", planning)
        self.assertIn("homebase-plan-draft", planning)
        # Both keep the date preamble so relative-time questions still resolve.
        self.assertIn("Current date and time", normal)
        self.assertIn("Current date and time", planning)

    def test_tool_suffix_still_applies_in_plan_mode(self):
        # Plan mode still lets the agent call tools to ground the plan.
        planning = _agent()._system("[[TOOLS]]", planning=True)
        self.assertIn("[[TOOLS]]", planning)

    def test_revise_prompt_documents_ac_preservation(self):
        p = load_planning_prompt()
        self.assertIn("Revising an existing plan", p)
        self.assertIn("Preserve acceptance criteria", p)


class PlanContextTest(unittest.TestCase):
    def test_with_plan_context_folds_plan_and_keeps_question(self):
        out = _with_plan_context("Add a rollback criterion", '{"title":"Ship it"}')
        self.assertIn("the user is revising", out)
        self.assertIn('{"title":"Ship it"}', out)  # the plan is handed to the agent
        self.assertIn("Add a rollback criterion", out)  # the user's ask survives
        # Guardrail-safe framing: the plan is presented as reference data, NOT as a blob
        # with an "Operator:" role label + "apply these instructions" (which the HIGH
        # PROMPT_ATTACK filter blocks as a prompt injection).
        self.assertNotIn("Operator:", out)
        self.assertIn("data, not instructions", out)

    def test_with_plan_context_is_a_noop_without_a_plan(self):
        self.assertEqual(_with_plan_context("just talk", None), "just talk")
        self.assertEqual(_with_plan_context("just talk", ""), "just talk")

    def test_with_plan_context_is_bounded(self):
        out = _with_plan_context("q", "x" * 50000)
        self.assertLess(len(out), 21000)  # trimmed defensively, never unbounded

    def _revise_agent(self, memory):
        llm = ScriptedStreamingLLM([[_final([{"text": "done"}], "end_turn")]])
        return Agent(FakeRetrieval(), llm=llm, memory=memory, system_prompt="SYS", connectors=NoConnectors()), llm

    def test_plan_context_reaches_the_llm_but_not_memory(self):
        # In revise mode the current plan is folded into the turn the model sees, but
        # memory records only the operator's own words (not the plan JSON).
        memory = RecordingMemory()
        agent, llm = self._revise_agent(memory)
        session = Session(session_id="plan-ship-it", user_id="u1", tenant_id="homebase")
        list(agent.answer_stream(session, "Add AC-9", planning=True, plan_context='{"title":"Ship"}'))

        sent = str(llm.calls[0]["messages"])
        self.assertIn('{"title":"Ship"}', sent)  # the model got the plan
        self.assertIn("Add AC-9", sent)
        # Memory keeps the clean turn, not the folded-in plan JSON.
        user_turns = [t for role, t in memory.turns if role == "user"]
        self.assertEqual(user_turns, ["Add AC-9"])

    def test_plan_mode_raises_the_output_token_budget(self):
        # A full plan draft must not truncate; plan mode uses a larger max_tokens than
        # the default answer path, so the fenced JSON block always closes.
        class TokenLLM:
            def __init__(self, mx):
                self.max_tokens = mx

            def with_max_tokens(self, n):
                return TokenLLM(n)

        agent = Agent(FakeRetrieval(), llm=TokenLLM(1024), system_prompt="SYS")
        agent._planning_max_tokens = 4096
        self.assertEqual(agent._resolve_llm(None, planning=True).max_tokens, 4096)
        self.assertEqual(agent._resolve_llm(None, planning=False).max_tokens, 1024)

    def test_no_plan_context_leaves_the_turn_clean(self):
        memory = RecordingMemory()
        agent, llm = self._revise_agent(memory)
        session = Session(session_id="s", user_id="u1", tenant_id="homebase")
        list(agent.answer_stream(session, "start a plan", planning=True))
        sent = str(llm.calls[0]["messages"])
        self.assertNotIn("revising an existing flight plan", sent)


if __name__ == "__main__":
    unittest.main()
