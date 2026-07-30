import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_agent.harness import HarnessError, main, run_harness
from homebase_agent.prompts import system_prompt_version


class HarnessTests(unittest.TestCase):
    def test_mock_harness_passes_and_asserts_citations(self):
        # main() in mock mode runs all cases and asserts citations; returns 0.
        self.assertEqual(main(["--mode", "mock"]), 0)

    def test_run_harness_reports_sources(self):
        from homebase_agent.agent import Agent
        from homebase_agent.llm import MockLLMClient
        from homebase_agent.mock import FakeKnowledgeBaseClient
        from homebase_agent.retrieval import RetrievalTool
        from homebase_agent.session import Session

        agent = Agent(
            RetrievalTool(FakeKnowledgeBaseClient(), "kb", rerank_model_arn="arn:mock"),
            llm=MockLLMClient(),
            system_prompt="p",
        )
        session = Session(session_id="s", user_id="u", tenant_id="t")
        report = run_harness(agent, session)
        grounded = [r for r in report if r[1]]
        self.assertTrue(grounded)
        for _question, _grounded, sources in grounded:
            self.assertTrue(sources)  # every grounded case cites at least one source

    def test_harness_fails_if_grounded_answer_lacks_citation(self):
        # An agent stub that claims grounded but returns no citations must be caught.
        from homebase_agent.agent import AnswerResult
        from homebase_agent.session import Session

        class BadAgent:
            def answer(self, session, question, **kw):
                return AnswerResult(text="x", grounded=True, citations=[], session=session)

        session = Session(session_id="s", user_id="u", tenant_id="t")
        with self.assertRaises(HarnessError):
            run_harness(BadAgent(), session, cases=[("q", True, None)])


class PromptTests(unittest.TestCase):
    def test_system_prompt_is_versioned(self):
        self.assertGreaterEqual(system_prompt_version(), 1)


if __name__ == "__main__":
    unittest.main()
