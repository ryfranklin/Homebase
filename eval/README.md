# eval/

The evaluation harness for Homebase, covering two layers:

- Retrieval eval (this stack): measures retrieval quality from the Bedrock Knowledge Base (hit rate,
  MRR) with rerank off versus on, so the rerank lift is visible and rerank has to earn its cost.
- Agent eval: end-to-end agent behavior (added later).

The retrieval eval is how we decide, on evidence, whether S3 Vectors semantic plus rerank clears the
bar, or whether we trigger the OpenSearch Serverless fallback (ADR-002). See
[../docs/retrieval.md](../docs/retrieval.md) for the S3 Vectors capability findings.

## Layout

```text
fixtures/cases.json           Synthetic question -> expected-source cases (invented, never real)
src/homebase_eval/
  models.py                   Case, RetrievalResult, Scorecard, load_cases
  metrics.py                  hit_at_k, reciprocal_rank
  retrievers.py               FixtureRetriever (offline), BedrockKBRetriever (live)
  runner.py                   score(), format_scorecard()
  cli.py                      prints the scorecard
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
