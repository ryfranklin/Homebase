"""Batch runner: run the multi-model matrix and persist results.

This is what the deployed eval stack's Fargate task executes. All AWS wiring
lives behind a ResultSink, so the batch orchestration is testable offline with
MemorySink and never imports boto3 in that path.

Persistence model (AwsSink):
- DynamoDB: one run header item plus one item per (model, case) score. Numbers
  are stored inside a JSON ``data`` attribute (strings), so there is no DynamoDB
  Decimal handling and the item shape stays simple.
- S3: the raw prompt and response text per (model, case), which are too big and
  too incidental to keep in DynamoDB.
- CloudWatch: EMF metric lines on stdout (Quality, LatencyMs, CostUsd) keyed by
  Model, which the awslogs driver turns into metrics with no PutMetricData call.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass


@dataclass
class RunConfig:
    """Everything that identifies and parameterizes one benchmark run.

    run_id, created_at, and git_sha are injected by the caller (the CLI), so this
    module needs no clock and stays deterministic under test.
    """

    run_id: str
    suite: str
    models: list
    judge: str
    created_at: str
    tenant_id: str = "homebase"
    user_id: str = "system"
    git_sha: str = ""
    repeats: int = 1


def run_batch(config: RunConfig, cases, targets, judge, pricing, sink) -> tuple:
    """Run the matrix, stream each score to the sink, and finalize the run.

    Returns (case_scores, scorecards). Imported here (not at module top) so the
    offline path pulls in only what it needs.
    """
    from .matrix import scorecards as build_scorecards
    from .matrix import run_matrix
    from .report import assemble, render_dashboard

    sink.record_run(config)

    records = []

    def on_case(case, response, score):
        records.append({
            "case_id": case.id,
            "model": score.model,
            "tags": list(case.tags),
            "prompt": case.prompt,
            "response": response.text,
            "quality": score.quality,
            "rationale": score.quality_rationale,
            "latency_ms": score.latency_ms,
            "cost_usd": score.cost_usd,
            "success": score.success,
            "error": score.error,
            "input_tokens": score.input_tokens,
            "output_tokens": score.output_tokens,
        })
        artifact = {
            "run_id": config.run_id,
            "model": score.model,
            "case_id": case.id,
            "prompt": case.prompt,
            "system": case.system,
            "response": response.text,
            "ok": response.ok,
            "error": response.error,
        }
        sink.record_score(config.run_id, score, artifact)
        sink.emit_metric(score.model, "Quality", score.quality, "None")
        sink.emit_metric(score.model, "LatencyMs", score.latency_ms, "Milliseconds")
        sink.emit_metric(score.model, "CostUsd", score.cost_usd, "None")

    scores = run_matrix(cases, targets, judge=judge, pricing=pricing, repeats=config.repeats, on_case=on_case)
    cards = build_scorecards(scores)
    sink.finalize(config, cards)

    # Build the run payload once. It powers two surfaces: the self-contained HTML
    # dashboard, and the JSON the BFF serves to the web SPA Evals tab. Same shape,
    # one contract (report.assemble).
    meta = {
        "suite": config.suite,
        "judge": config.judge,
        "models": config.models,
        "generated_at": config.created_at,
        "n_cases": len(cases),
        "git_sha": config.git_sha,
        "run_id": config.run_id,
        "tenant_id": config.tenant_id,
    }
    run_data = assemble(meta, cards, records, cases)
    if hasattr(sink, "write_payload"):
        sink.write_payload(config.run_id, run_data)
    if hasattr(sink, "write_dashboard"):
        sink.write_dashboard(config.run_id, render_dashboard(run_data))

    return scores, cards


class MemorySink:
    """Offline sink: keeps everything in memory for tests and dry runs."""

    def __init__(self):
        self.run = None
        self.scores = []
        self.artifacts = {}
        self.metrics = []
        self.scorecards = None
        self.dashboard = None
        self.payload = None

    def record_run(self, config):
        self.run = config

    def record_score(self, run_id, score, artifact):
        self.scores.append(score)
        self.artifacts[(score.model, score.case_id)] = artifact

    def emit_metric(self, model, name, value, unit):
        self.metrics.append((model, name, value, unit))

    def finalize(self, config, cards):
        self.scorecards = cards

    def write_dashboard(self, run_id, html):
        self.dashboard = html

    def write_payload(self, run_id, payload):
        self.payload = payload


class AwsSink:
    """Live sink: DynamoDB run ledger, S3 artifacts, EMF metrics on stdout.

    Uses the DynamoDB resource API with all-string items, so no Decimal handling
    is needed. boto3 is imported lazily; pass ``clients`` (a dict with ``table``
    and ``s3``) to inject fakes in tests without AWS.
    """

    def __init__(self, *, table_name, bucket, region=None, namespace="Homebase/Eval", now_ms=None, clients=None):
        self._bucket = bucket
        self._namespace = namespace
        # Injected clock keeps EMF timestamps testable; default to wall clock.
        if now_ms is not None:
            self._now_ms = now_ms
        else:
            import time

            self._now_ms = lambda: int(time.time() * 1000)

        if clients is not None:
            self._table = clients["table"]
            self._s3 = clients["s3"]
        else:
            import boto3

            self._table = boto3.resource("dynamodb", region_name=region).Table(table_name)
            self._s3 = boto3.client("s3", region_name=region)

    def record_run(self, config):
        self._table.put_item(
            Item={
                "pk": f"TENANT#{config.tenant_id}",
                "sk": f"RUN#{config.created_at}#{config.run_id}",
                "type": "run",
                "run_id": config.run_id,
                "suite": config.suite,
                "judge": config.judge,
                "status": "running",
                "data": json.dumps(asdict(config)),
            }
        )

    def record_score(self, run_id, score, artifact):
        key = f"runs/{run_id}/{score.model}/{score.case_id}.json"
        self._s3.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=json.dumps(artifact).encode("utf-8"),
            ContentType="application/json",
        )
        self._table.put_item(
            Item={
                "pk": f"RUN#{run_id}",
                "sk": f"SCORE#{score.model}#{score.case_id}",
                "type": "score",
                "run_id": run_id,
                "model": score.model,
                "case_id": score.case_id,
                "artifact_key": key,
                "data": json.dumps(asdict(score)),
            }
        )

    def emit_metric(self, model, name, value, unit):
        # Embedded Metric Format: the awslogs driver + CloudWatch turn this into a
        # metric keyed by Model, with no PutMetricData permission required.
        line = {
            "_aws": {
                "Timestamp": self._now_ms(),
                "CloudWatchMetrics": [
                    {
                        "Namespace": self._namespace,
                        "Dimensions": [["Model"]],
                        "Metrics": [{"Name": name, "Unit": unit}],
                    }
                ],
            },
            "Model": model,
            name: value,
        }
        print(json.dumps(line))

    def finalize(self, config, cards):
        self._table.put_item(
            Item={
                "pk": f"TENANT#{config.tenant_id}",
                "sk": f"RUN#{config.created_at}#{config.run_id}",
                "type": "run",
                "run_id": config.run_id,
                "suite": config.suite,
                "judge": config.judge,
                "status": "complete",
                "data": json.dumps(asdict(config)),
                "scorecards": json.dumps([asdict(c) for c in cards]),
            }
        )

    def write_dashboard(self, run_id, html):
        # A browsable per-run dashboard alongside the raw artifacts.
        self._s3.put_object(
            Bucket=self._bucket,
            Key=f"dashboards/{run_id}.html",
            Body=html.encode("utf-8"),
            ContentType="text/html; charset=utf-8",
        )

    def write_payload(self, run_id, payload):
        # The JSON the BFF serves to the web SPA Evals tab (same shape as the
        # dashboard's embedded data).
        self._s3.put_object(
            Bucket=self._bucket,
            Key=f"runs/{run_id}/payload.json",
            Body=json.dumps(payload).encode("utf-8"),
            ContentType="application/json",
        )
