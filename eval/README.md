# eval/

The evaluation harness for Homebase, covering two layers:

- Retrieval eval: measures the quality of hybrid retrieval from the Bedrock Knowledge Base
  (recall, precision, ranking) against curated question and answer sets.
- Agent eval: measures end to end agent behavior (tool selection, grounding, correctness) across
  scenarios.

Eval datasets must not contain real secrets or personal data. Use synthetic or clearly placeholder
fixtures. Configuration comes from environment variables, never literals.
