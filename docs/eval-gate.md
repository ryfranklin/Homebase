# The retrieval eval gate

CI runs a retrieval regression gate on every push and pull request (the `eval-gate` job). This note
states exactly what it does and does not prove, so a green check is not mistaken for a quality
guarantee.

## What it is

`cd eval && python -m homebase_eval.cli --gate` scores the committed synthetic fixtures
(`eval/fixtures/cases.json`) and fails (exit non-zero) if reranked `hit_rate@k` or `MRR` falls below
committed floors, or if rerank lift collapses. It blocks a merge that regresses the retrieval code.

## What it proves

- The retrieval CODE (ranking, metadata filtering, the rerank fold, the scorecard) still behaves on a
  fixed, known input. A change that breaks that logic drops the fixture score and the gate goes red.

## What it does NOT prove

- It does NOT measure absolute retrieval quality on your real corpus. The fixtures are invented
  content, not your vault. A green gate is not a promise that production retrieval is good.
- Absolute quality is the SEPARATE live eval you run by hand against your real corpus post-deploy
  (the ADR-002 decision: does S3 Vectors semantic + rerank clear the bar, or do we fall back to
  OpenSearch Serverless). That eval uses real AWS and never runs in CI.

## Offline and credential-free (public repo)

The gate runs entirely offline against fixtures. It is never given AWS credentials or secrets. This is
a public repository; the CI must not carry cloud credentials.

## Proven both ways

The gate is exercised in both directions in `eval/tests/test_gate.py`: clean fixtures pass (green),
and a seeded regression (degraded rankings) fails (red). A gate never shown to fail is not a gate.

## Tuning the floors

The floors live in `eval/src/homebase_eval/gate.py`
(`DEFAULT_MIN_RERANKED_HIT_RATE`, `DEFAULT_MIN_RERANKED_MRR`, `DEFAULT_MIN_HIT_RATE_LIFT`). Raise them
as the fixtures and retrieval improve; keep headroom so ordinary noise does not flake the gate.
