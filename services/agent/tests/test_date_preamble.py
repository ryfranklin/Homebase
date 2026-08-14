import unittest
from datetime import datetime, timezone

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_agent.agent import Agent, _now_preamble
from homebase_agent.llm import MockLLMClient
from homebase_agent.mock import FakeKnowledgeBaseClient
from homebase_agent.retrieval import RetrievalTool


class DatePreambleTest(unittest.TestCase):
    def test_preamble_uses_the_given_date(self):
        pre = _now_preamble(datetime(2026, 8, 14, 15, 30, tzinfo=timezone.utc))
        self.assertIn("2026-08-14 15:30 UTC", pre)
        self.assertIn("relative times", pre)

    def test_preamble_converts_to_the_configured_timezone(self):
        # 16:00 UTC is 12:00 EDT on 2026-08-14 (summer, UTC-4).
        pre = _now_preamble(datetime(2026, 8, 14, 16, 0, tzinfo=timezone.utc), tz_name="America/New_York")
        self.assertIn("2026-08-14 12:00 EDT", pre)

    def test_unknown_timezone_falls_back_to_utc(self):
        pre = _now_preamble(datetime(2026, 8, 14, 16, 0, tzinfo=timezone.utc), tz_name="Not/AZone")
        self.assertIn("16:00 UTC", pre)

    def test_system_prepends_the_current_date_to_the_prompt(self):
        tool = RetrievalTool(FakeKnowledgeBaseClient(), "kb-1", rerank_model_arn="arn:mock:rerank")
        agent = Agent(tool, llm=MockLLMClient(), system_prompt="BASE PROMPT")
        system = agent._system(" SUFFIX")
        self.assertIn("Current date and time:", system)
        self.assertIn("BASE PROMPT", system)
        self.assertTrue(system.endswith(" SUFFIX"))


if __name__ == "__main__":
    unittest.main()
