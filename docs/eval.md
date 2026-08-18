# Evaluation harness

Homebase evaluates itself on evidence. The harness has two layers that share one
package (`eval/`, `homebase_eval`):

1. **Retrieval eval** measures Knowledge Base retrieval quality (hit rate, MRR,
   rerank lift). It decides whether S3 Vectors semantic plus rerank clears the bar
   or whether the OpenSearch fallback is warranted (ADR-002). See
   [eval-gate.md](eval-gate.md) and [retrieval.md](retrieval.md).
2. **Multi-model generation eval** runs one task suite across many Bedrock models
   and ranks them on quality, latency, cost, and task success. This is what the
   deployed `eval` stack runs. The rest of this doc covers it.

## Why multi-model

This account can call Claude, GLM, Kimi, Qwen, Llama, and DeepSeek through one
Bedrock **Converse** API and one instance-role auth plane, so "best model per
Homebase seam" is a real, evidence-based choice, not a guess. The harness is how
that evidence is produced. Grok is the notable absence: it is not in Bedrock, so
using it would mean an out-of-Bedrock integration.

## How it works

Every model is a `BedrockConverseTarget`, so the same suite drives every provider
with no per-provider code. Each `(model, case)` pair is scored on:

- **quality**: an LLM judge (itself a target) returns a 0..1 score against a
  rubric and optional reference answer;
- **latency**: wall-clock around the Converse call (p50 / p95);
- **cost**: token usage times a pricing table (an SSM parameter in the deployed
  stack, read at run time);
- **success**: deterministic checks (substring, regex, valid JSON, required keys).

A failed model call is a scored miss, not a crashed run. Results aggregate into a
per-model leaderboard ranked by quality then cost.

## Running it

- **Locally, offline (no AWS):** `PYTHONPATH=src python -m homebase_eval.gen_cli`
  in `eval/`. Deterministic mocks exercise the whole pipeline.
- **Locally, live:** `homebase_eval.gen_cli --mode live --models ... --judge ...`
  needs boto3, credentials, and Bedrock access. Spends tokens.
- **Deployed, on demand:** the `eval` stack (see
  [../infra/stacks/eval/README.md](../infra/stacks/eval/README.md)) runs the batch
  runner as a Fargate task that writes a run ledger to DynamoDB, raw artifacts to
  S3, and quality/latency/cost metrics to a CloudWatch dashboard. Launch with
  `scripts/run-eval.sh`. There is no schedule: runs are on demand, so the stack is
  idle-cost only.

## Interactive dashboard

Every run can produce a self-contained, interactive HTML dashboard (no external
dependencies): a sortable leaderboard, a models-by-capability quality heatmap, a
quality-vs-cost scatter, latency bars, and a filterable per-case drill-down that
shows each case's prompt, the model's response, and the judge's rationale. Locally
it is `gen_cli --html <path>`; the deployed runner writes one per run to
`s3://<eval-artifacts-bucket>/dashboards/<run_id>.html`. The payload shape
(`report.assemble`) is the contract the future web SPA "Evals" tab will reuse.

Full package layout and CLI reference: [../eval/README.md](../eval/README.md).

## Findings (2026-08-17)

A live 3-model run (Sonnet 4.6 vs Qwen3-Next-80B vs GLM-5), judge rotated across
all three, on the smoke suite:

- **Model access:** Opus 4.8, Opus 5, and Sonnet 5 return AccessDenied in this
  account. Sonnet 4.6 and Haiku 4.5 are enabled; all Qwen and GLM variants work.
  This set the cockpit model (Sonnet 4.6, not Opus) and the default judge.
- **Quality ceiling:** the 4-case smoke suite is too easy to separate models on
  quality (all ~0.98 to 1.0). Harder, discriminating suites are the next step.
- **Separation was latency and cost:** Qwen3-Next-80B fastest, Sonnet 4.6 middle,
  GLM-5 slowest but cheapest of the priced models.
- **Judge calibration:** only Sonnet 4.6 discriminated; GLM-5 and Qwen rated
  everything a flat 1.0. So the judge is a **single Sonnet 4.6**, not a panel: the
  non-Anthropic judges are too lenient to balance it. Revisit if a harder suite
  shows Sonnet self-favoring Claude candidates.

## Roadmap

Built: the multi-model engine and the deployed stack. Next: harder real suites
(vault QA goldens, coding tasks), publishing the leaderboard back into the vault
so the agent can answer "which model is best for X", and adapters that treat the
RAG agent and the Mission Control worker as targets.
