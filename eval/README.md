# eval/

The evaluation harness for Homebase, covering three layers:

- Retrieval eval: measures retrieval quality from the Bedrock Knowledge Base (hit rate, MRR) with
  rerank off versus on, so the rerank lift is visible and rerank has to earn its cost.
- Generation / multi-model eval: runs one task suite across many Bedrock models over the Converse
  API and scores each on quality (LLM judge), latency, cost, and task success, so model choice per
  Homebase seam is made on evidence. See [Multi-model generation eval](#multi-model-generation-eval).
- Agent eval: end-to-end agent behavior (added later).

The retrieval eval is how we decide, on evidence, whether S3 Vectors semantic plus rerank clears the
bar, or whether we trigger the OpenSearch Serverless fallback (ADR-002). See
[../docs/retrieval.md](../docs/retrieval.md) for the S3 Vectors capability findings.

## Layout

```text
fixtures/cases.json           Synthetic question -> expected-source cases (invented, never real)
fixtures/gen_cases.json       Synthetic generation task suite (invented, never real)
fixtures/pricing.json         Per-model $/Mtok table (PLACEHOLDER; verify against Bedrock pricing)
src/homebase_eval/
  models.py                   Retrieval: Case, RetrievalResult, Scorecard, load_cases
  metrics.py                  Retrieval metrics + mean()
  retrievers.py               FixtureRetriever (offline), BedrockKBRetriever (live)
  runner.py                   Retrieval score(), format_scorecard()
  cli.py                      Retrieval scorecard CLI (homebase-eval)
  gen_models.py               Generation: GenCase, ModelResponse, CaseScore, ModelScorecard
  targets.py                  MockModelTarget (offline), BedrockConverseTarget (live, model-agnostic)
  pricing.py                  Cost model from the pricing table
  scorers.py                  quality (LLM judge), latency, cost, task success
  matrix.py                   run_matrix(), scorecards(), format_leaderboard()
  gen_cli.py                  Multi-model leaderboard CLI (homebase-eval-models)
tests/                        Offline unit tests (no AWS)
```

## Metrics

- `hit_rate@k`: fraction of cases whose expected source appears in the top k results.
- `MRR`: mean reciprocal rank of the first expected source.
- Rerank lift: the reranked value minus the base value for each metric. This is the number that
  justifies (or does not justify) the extra rerank call.

## Fixtures are synthetic

`fixtures/cases.json` is invented content about a fictional "Acme Robotics" handbook. It is never
your real corpus. Live evaluation against the real corpus happens on your machine after deploy and is
not committed.

## Run offline (no AWS)

```bash
cd eval
python -m unittest discover -s tests     # unit tests
PYTHONPATH=src python -m homebase_eval.cli --mode offline --k 3
```

Offline mode scores the committed synthetic rankings deterministically, so the harness and its
scorecard are exercised with no credentials and no network.

## Run live (against a deployed KB, post-deploy, on your machine)

```bash
pip install -e '.[live]'
export HOMEBASE_KB_ID=<your-knowledge-base-id>          # from SSM: /homebase/<env>/retrieval/knowledge_base_id
export HOMEBASE_RERANK_MODEL_ARN=<your-rerank-model-arn>
export AWS_REGION=<YOUR_AWS_REGION>
PYTHONPATH=src python -m homebase_eval.cli --mode live --k 3 \
  --cases fixtures/cases.json    # or point at your own private, uncommitted case file
```

Live mode issues two Retrieve calls per question (rerank off, rerank on) and scores the same way.
S3 Vectors is semantic-only, so search type stays SEMANTIC; rerank is applied at query time. Confirm
the rerank configuration shape against the `bedrock-agent-runtime` Retrieve API version in your
region before trusting the live numbers.

## Multi-model generation eval

Runs one task suite across many Bedrock models and ranks them on quality, latency, cost, and task
success. It is model-agnostic by construction: every model is called through the Bedrock **Converse**
API, so the same suite drives Claude, GLM, Kimi, Qwen, Llama, DeepSeek, Nova, and Mistral with no
per-provider code. The LLM judge is itself a target, so the judge model is a deliberate, swappable
choice, and offline runs judge with a deterministic mock (no AWS).

Metrics per (model, case): `quality` (judge score in [0, 1]), `latency_ms` (wall-clock around the
Converse call), `cost_usd` (token usage times the pricing table), and `success` (deterministic
checks: substring, regex, valid JSON, required JSON keys). A failed model call is a scored miss, not
a crash.

### Run offline (no AWS)

```bash
cd eval
PYTHONPATH=src python -m homebase_eval.gen_cli
```

Offline uses deterministic mock models and a mock judge, so the matrix, scoring, and leaderboard are
exercised with no credentials and no spend.

### Run live (real Bedrock models, spends tokens)

```bash
pip install -e '.[live]'
export AWS_REGION=us-east-1
PYTHONPATH=src python -m homebase_eval.gen_cli --mode live \
  --models us.anthropic.claude-opus-4-8,zai.glm-5,moonshotai.kimi-k2.5,qwen.qwen3-coder-next \
  --judge us.anthropic.claude-opus-4-8
```

Live mode needs boto3, credentials (instance role or profile), and Bedrock access to each model id.
Confirm on-demand pricing for your region and override `fixtures/pricing.json` (or pass `--pricing`)
before trusting the cost column. `--min-quality <floor>` turns the run into a gate (non-zero exit if
the best model is below the floor); `--json` emits machine-readable scorecards for the deployed
stack to store.

### Fixtures are synthetic

`fixtures/gen_cases.json` is an invented smoke suite; `fixtures/pricing.json` holds placeholder
prices. Real suites and real prices are your inputs, kept out of the committed fixtures.
