"""Tests for the HTML dashboard renderer. No AWS, no browser.
unittest.TestCase style for CI's discover."""

from __future__ import annotations

import json
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_eval.gen_models import GenCase
from homebase_eval.matrix import run_matrix, scorecards
from homebase_eval.report import assemble, render_dashboard
from homebase_eval.targets import MockModelTarget


def _run():
    cases = [
        GenCase(id="q1", prompt="p1", reference="answer one", tags=["reasoning"]),
        GenCase(id="q2", prompt="p2", reference="answer two", tags=["coding"], expect_contains=["two"]),
    ]
    strong = MockModelTarget("strong", responder=lambda c: c.reference)
    judge = MockModelTarget("judge", responder=lambda jc: '{"score": 0.9, "rationale": "ok"}')
    records = []

    def on_case(case, response, score):
        records.append({
            "case_id": case.id, "model": score.model, "tags": list(case.tags),
            "prompt": case.prompt, "response": response.text, "quality": score.quality,
            "rationale": score.quality_rationale, "latency_ms": score.latency_ms,
            "cost_usd": score.cost_usd, "success": score.success, "error": score.error,
            "input_tokens": score.input_tokens, "output_tokens": score.output_tokens,
        })

    scores = run_matrix(cases, [strong], judge=judge, pricing={"strong": (1.0, 1.0)}, on_case=on_case)
    return cases, scorecards(scores), records


class AssembleTests(unittest.TestCase):
    def test_payload_shape(self):
        cases, cards, records = _run()
        meta = {"suite": "t", "judge": "judge", "models": ["strong"]}
        data = assemble(meta, cards, records, cases)
        self.assertEqual(data["meta"]["suite"], "t")
        self.assertEqual(len(data["scorecards"]), 1)
        self.assertEqual(len(data["cases"]), 2)
        self.assertEqual({t["tag"] for t in data["tags"]}, {"reasoning", "coding"})
        # Cases carry the drill-down fields.
        self.assertIn("prompt", data["cases"][0])
        self.assertIn("response", data["cases"][0])


class RenderTests(unittest.TestCase):
    def test_self_contained_and_embeds_data(self):
        cases, cards, records = _run()
        html = render_dashboard(assemble({"suite": "t", "judge": "judge", "models": ["strong"]}, cards, records, cases))
        self.assertTrue(html.startswith("<!doctype html>"))
        # No external dependencies.
        self.assertNotIn("http://", html)
        self.assertNotIn("https://", html)
        self.assertNotIn("__DATA__", html)
        self.assertIn('id="data"', html)

    def test_script_close_is_neutralized(self):
        # A model response containing </script> must not break the data block.
        cases = [GenCase(id="x", prompt="p", reference="r", tags=["t"])]
        evil = MockModelTarget("m", responder=lambda c: "oops </script> boom")
        judge = MockModelTarget("j", responder=lambda jc: '{"score":0.5,"rationale":"x"}')
        records = []
        run_matrix(
            cases, [evil], judge=judge, pricing={},
            on_case=lambda case, resp, sc: records.append({
                "case_id": case.id, "model": sc.model, "tags": list(case.tags), "prompt": case.prompt,
                "response": resp.text, "quality": sc.quality, "rationale": sc.quality_rationale,
                "latency_ms": sc.latency_ms, "cost_usd": sc.cost_usd, "success": sc.success,
                "error": sc.error, "input_tokens": 0, "output_tokens": 0,
            }),
        )
        cards = scorecards(run_matrix(cases, [evil], judge=judge, pricing={}))
        html = render_dashboard(assemble({"suite": "t", "judge": "j", "models": ["m"]}, cards, records, cases))
        # The literal closing tag must be escaped in the embedded JSON.
        self.assertNotIn("</script> boom", html)
        self.assertIn("<\\/script>", html)


if __name__ == "__main__":
    unittest.main()
