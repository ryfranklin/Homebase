# services/agent

The Homebase agent: Claude on Bedrock, hosted on AgentCore Runtime, answering only from passages
retrieved from the P5 Knowledge Base and attaching source citations to every grounded answer.

## Design

- `session.py`: the session model. User and tenant identity are explicit (`tenant_id` matches the
  Cognito claim), so the agent plane does not become a single-tenant one-way door.
- `retrieval.py`: the retrieval tool and the ADR-002 compensation ladder. S3 Vectors is
  semantic-only, so the tool over-retrieves a wide dense candidate set (rung 1), reranks with Bedrock
  Rerank (rung 2), and exposes tag / folder / recency filters. Server-side filters use only
  S3-Vectors-supported operators; the folder prefix filter is applied client-side because S3 Vectors
  does not support `startsWith`.
- `prompts/system_prompt.md`: the versioned system prompt (the source of truth; `prompts.py` reads it
  and its `Version:` marker).
- `llm.py`: `BedrockLLMClient` (Converse; model id is a variable, so Opus vs Sonnet is config) and
  `MockLLMClient` for offline runs. Every Converse call carries the Bedrock Guardrail (created by the
  `agent` stack), so one governance layer protects all doors (GUI, CLI, Slack) at the model boundary:
  prompt-attack detection on input, hate/insults/sexual/violence/misconduct content filters, and one
  DENY topic (credential exfiltration). PII detection is deliberately off (this is a personal assistant).
- `memory.py`: AgentCore Memory wrappers (short-term events + long-term recall), with `NullMemory`
  default. The actor id is namespaced by tenant.
- `agent.py`: orchestration. A grounded answer always carries citations; when retrieval finds
  nothing, the agent falls back to general knowledge behind a visible "not from your knowledge
  base" disclaimer (ungrounded, no citations) rather than silently guessing.
- `server.py`: the AgentCore Runtime HTTP contract (`POST /invocations`, `GET /ping` on 8080).
- `harness.py`: the local harness that asserts citations.

## Configuration (all non-secret, from env / SSM)

`HOMEBASE_KB_ID`, `HOMEBASE_RERANK_MODEL_ARN`, `HOMEBASE_MODEL_ID`, `HOMEBASE_MEMORY_ID`,
`AWS_REGION`. No account, model id, or KB id is baked into the image.

## Run the harness

```bash
cd services/agent
python -m unittest discover -s tests          # unit tests, offline, no AWS
PYTHONPATH=src python -m homebase_agent.harness --mode mock

# Live (post-deploy, on your machine):
pip install -e '.[live]'
export HOMEBASE_KB_ID=<kb-id> AWS_REGION=<YOUR_AWS_REGION>
export HOMEBASE_RERANK_MODEL_ARN=<rerank-arn> HOMEBASE_MODEL_ID=<claude-model-id>
PYTHONPATH=src python -m homebase_agent.harness --mode live
```

Mock mode asserts that every grounded answer carries source metadata and that the no-source case
falls back behind the general-knowledge disclaimer, all with no AWS calls.

## CI image check

On PRs and pushes to `main` that touch `services/agent/**`, the `build-agent` job in
`.github/workflows/ci.yml` builds the production `linux/arm64` image and runs the same import +
connector-tool assertions as `scripts/deploy-agent.sh` (image imports `homebase_agent.server`, and
`CONNECTOR_TOOLS` is non-empty and includes `confluence_search`). It does not push to ECR or apply:
pushing the image and running `terraform apply` stay human. This catches broken or stale images (a
missing package-data file, an import error, a dropped connector tool) before a deploy.
