import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_agent.agent import Agent
from homebase_agent.llm import MockLLMClient
from homebase_agent.mock import FakeKnowledgeBaseClient
from homebase_agent.prompts import load_planning_prompt
from homebase_agent.retrieval import RetrievalTool


def _agent(system_prompt="BASE-SYSTEM-PROMPT"):
    tool = RetrievalTool(FakeKnowledgeBaseClient(), "kb-1", rerank_model_arn="arn:mock:rerank")
    return Agent(tool, llm=MockLLMClient(), system_prompt=system_prompt)


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


if __name__ == "__main__":
    unittest.main()
