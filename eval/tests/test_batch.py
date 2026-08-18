"""Offline tests for the batch runner. MemorySink needs no AWS; AwsSink is
exercised with fake DynamoDB/S3 clients, so nothing hits the network."""

from __future__ import annotations

import json

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


def test_run_batch_memory_sink_records_everything():
    targets, judge = _targets_and_judge()
    sink = MemorySink()
    pricing = {"m1": (1.0, 1.0), "m2": (1.0, 1.0)}

    scores, cards = run_batch(_config(), _cases(), targets, judge, pricing, sink)

    assert sink.run.run_id == "run123"
    assert len(scores) == 4  # 2 models x 2 cases
    assert len(sink.scores) == 4
    # One artifact per (model, case), carrying the raw response text.
    assert set(sink.artifacts.keys()) == {("m1", "q1"), ("m1", "q2"), ("m2", "q1"), ("m2", "q2")}
    assert sink.artifacts[("m1", "q1")]["response"] == "answer one"
    # Three metrics per case (quality, latency, cost) -> 12 total.
    assert len(sink.metrics) == 12
    names = {m[1] for m in sink.metrics}
    assert names == {"Quality", "LatencyMs", "CostUsd"}
    # Finalized scorecards, best model first.
    assert [c.model for c in cards] == ["m1", "m2"]
    assert sink.scorecards[0].model == "m1"


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


def test_aws_sink_item_and_key_shapes():
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

    # Run header written twice: once running, once complete (with scorecards).
    run_items = [i for i in table.items if i["type"] == "run"]
    assert run_items[0]["status"] == "running"
    assert run_items[-1]["status"] == "complete"
    assert "scorecards" in run_items[-1]
    assert run_items[0]["pk"] == "TENANT#homebase"

    # One score item + one S3 artifact per (model, case).
    score_items = [i for i in table.items if i["type"] == "score"]
    assert len(score_items) == 4
    s = score_items[0]
    assert s["pk"] == "RUN#run123"
    assert s["sk"].startswith("SCORE#")
    assert s["artifact_key"] in {k[1] for k in s3.objects}
    # data is JSON-serializable strings only (no Decimal / float attrs on the item).
    assert isinstance(s["data"], str)
    assert json.loads(s["data"])["case_id"] in {"q1", "q2"}

    assert ("b", "runs/run123/m1/q1.json") in s3.objects


def test_aws_sink_emits_emf_metric(capsys):
    table, s3 = _FakeTable(), _FakeS3()
    sink = AwsSink(table_name="t", bucket="b", now_ms=lambda: 777, clients={"table": table, "s3": s3})
    sink.emit_metric("m1", "Quality", 0.9, "None")
    out = capsys.readouterr().out.strip()
    line = json.loads(out)
    assert line["Model"] == "m1"
    assert line["Quality"] == 0.9
    assert line["_aws"]["Timestamp"] == 777
    assert line["_aws"]["CloudWatchMetrics"][0]["Namespace"] == "Homebase/Eval"
