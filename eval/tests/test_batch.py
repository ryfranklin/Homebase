"""Offline tests for the batch runner. MemorySink needs no AWS; AwsSink is
exercised with fake DynamoDB/S3 clients, so nothing hits the network.
unittest.TestCase style for CI's discover."""

from __future__ import annotations

import contextlib
import io
import json
import unittest

import _bootstrap  # noqa: F401  (sets up sys.path)

from homebase_eval.batch import AwsSink, MemorySink, RunConfig, run_batch
from homebase_eval.gen_models import GenCase
from homebase_eval.targets import MockModelTarget


def _cases():
    return [
        GenCase(id="q1", prompt="p1", reference="answer one"),
        GenCase(id="q2", prompt="p2", reference="answer two", expect_contains=["two"]),
    ]


def _config(**kw):
    base = dict(
        run_id="run123",
        suite="gen_cases.json",
        models=["m1", "m2"],
        judge="judge",
        created_at="2026-08-17T00:00:00+00:00",
    )
    base.update(kw)
    return RunConfig(**base)


def _targets_and_judge():
    m1 = MockModelTarget("m1", responder=lambda c: c.reference)
    m2 = MockModelTarget("m2", responder=lambda c: "not sure")
    judge = MockModelTarget(
        "judge",
        responder=lambda jc: json.dumps({"score": 0.2 if "not sure" in jc.prompt.lower() else 0.9, "rationale": "x"}),
    )
    return [m1, m2], judge


class _FakeTable:
    def __init__(self):
        self.items = []

    def put_item(self, Item):
        self.items.append(Item)


class _FakeS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[(Bucket, Key)] = Body


class MemorySinkTests(unittest.TestCase):
    def test_run_batch_records_everything(self):
        targets, judge = _targets_and_judge()
        sink = MemorySink()
        pricing = {"m1": (1.0, 1.0), "m2": (1.0, 1.0)}

        scores, cards = run_batch(_config(), _cases(), targets, judge, pricing, sink)

        self.assertEqual(sink.run.run_id, "run123")
        self.assertEqual(len(scores), 4)
        self.assertEqual(len(sink.scores), 4)
        self.assertEqual(
            set(sink.artifacts.keys()), {("m1", "q1"), ("m1", "q2"), ("m2", "q1"), ("m2", "q2")}
        )
        self.assertEqual(sink.artifacts[("m1", "q1")]["response"], "answer one")
        self.assertEqual(len(sink.metrics), 12)
        self.assertEqual({m[1] for m in sink.metrics}, {"Quality", "LatencyMs", "CostUsd"})
        self.assertEqual([c.model for c in cards], ["m1", "m2"])
        self.assertEqual(sink.scorecards[0].model, "m1")
        # A self-contained dashboard was rendered for the run.
        self.assertIsNotNone(sink.dashboard)
        self.assertIn("<!doctype html>", sink.dashboard)
        # The BFF payload (same shape as the dashboard data) was produced.
        self.assertIsNotNone(sink.payload)
        self.assertEqual(sink.payload["meta"]["run_id"], "run123")
        self.assertEqual(len(sink.payload["cases"]), 4)


class AwsSinkTests(unittest.TestCase):
    def test_item_and_key_shapes(self):
        table, s3 = _FakeTable(), _FakeS3()
        sink = AwsSink(
            table_name="t",
            bucket="b",
            namespace="Homebase/Eval",
            now_ms=lambda: 1234,
            clients={"table": table, "s3": s3},
        )
        targets, judge = _targets_and_judge()
        run_batch(_config(), _cases(), targets, judge, {"m1": (1.0, 1.0), "m2": (1.0, 1.0)}, sink)

        run_items = [i for i in table.items if i["type"] == "run"]
        self.assertEqual(run_items[0]["status"], "running")
        self.assertEqual(run_items[-1]["status"], "complete")
        self.assertIn("scorecards", run_items[-1])
        self.assertEqual(run_items[0]["pk"], "TENANT#homebase")

        score_items = [i for i in table.items if i["type"] == "score"]
        self.assertEqual(len(score_items), 4)
        s = score_items[0]
        self.assertEqual(s["pk"], "RUN#run123")
        self.assertTrue(s["sk"].startswith("SCORE#"))
        self.assertIn(s["artifact_key"], {k[1] for k in s3.objects})
        self.assertIsInstance(s["data"], str)
        self.assertIn(json.loads(s["data"])["case_id"], {"q1", "q2"})
        self.assertIn(("b", "runs/run123/m1/q1.json"), s3.objects)
        # The per-run dashboard and BFF payload were written to S3.
        self.assertIn(("b", "dashboards/run123.html"), s3.objects)
        self.assertIn(("b", "runs/run123/payload.json"), s3.objects)

    def test_emits_emf_metric(self):
        table, s3 = _FakeTable(), _FakeS3()
        sink = AwsSink(table_name="t", bucket="b", now_ms=lambda: 777, clients={"table": table, "s3": s3})
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            sink.emit_metric("m1", "Quality", 0.9, "None")
        line = json.loads(buf.getvalue().strip())
        self.assertEqual(line["Model"], "m1")
        self.assertEqual(line["Quality"], 0.9)
        self.assertEqual(line["_aws"]["Timestamp"], 777)
        self.assertEqual(line["_aws"]["CloudWatchMetrics"][0]["Namespace"], "Homebase/Eval")


if __name__ == "__main__":
    unittest.main()
