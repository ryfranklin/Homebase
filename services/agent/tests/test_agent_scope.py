import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_agent.agent import Agent
from homebase_agent.llm import MockLLMClient
from homebase_agent.mock import FakeKnowledgeBaseClient
from homebase_agent.prompts import load_vault_only_prompt
from homebase_agent.retrieval import RetrievalTool


def _agent():
    tool = RetrievalTool(FakeKnowledgeBaseClient(), "kb-1", rerank_model_arn="arn:mock:rerank")
    return Agent(tool, llm=MockLLMClient(), system_prompt="DEFAULT-SYS")


class ScopeSystemPromptTests(unittest.TestCase):
    def test_vault_only_prompt_loads(self):
        text = load_vault_only_prompt()
        self.assertIn("Vault-only mode", text)
        self.assertIn("Do NOT use general knowledge", text)

    def test_vault_scope_uses_strict_prompt(self):
        a = _agent()
        sys_vault = a._system(scope="vault")
        self.assertIn("Vault-only mode", sys_vault)
        self.assertIn("Do NOT use general knowledge", sys_vault)

    def test_general_scope_uses_default_prompt(self):
        a = _agent()
        sys_general = a._system(scope="general")
        self.assertIn("DEFAULT-SYS", sys_general)
        self.assertNotIn("Vault-only mode", sys_general)

    def test_planning_overrides_scope(self):
        a = _agent()
        # Plan mode wins even if scope is vault: it runs the AI-DLC interview prompt.
        sys_plan = a._system(planning=True, scope="vault")
        self.assertNotIn("Vault-only mode", sys_plan)


if __name__ == "__main__":
    unittest.main()
