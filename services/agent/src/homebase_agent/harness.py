"""Local harness that exercises the agent and asserts citations.

Mock mode (default) runs against the offline fake Knowledge Base with a mock
LLM: no AWS. Live mode wires the real clients against a deployed KB. Every
grounded answer must carry source metadata; the no-source case must say so
rather than hallucinate.
"""

from __future__ import annotations

import argparse
import os
import sys

from .agent import NO_SOURCES_MESSAGE, Agent
from .retrieval import RetrievalTool
from .session import Session

# (question, expect_grounded, expected_source_substring_or_None)
DEFAULT_CASES = [
    ("How do I rotate the encryption key?", True, "ops/key-rotation.md"),
    ("What is the warranty on the R-200 arm?", True, "products/r200-warranty.md"),
    ("Where are the vision calibration steps?", True, "guides/vision-calibration.md"),
    ("What is the airspeed velocity of an unladen swallow?", False, None),
]


class HarnessError(AssertionError):
    pass


def run_harness(agent, session, cases=None) -> list:
    cases = cases or DEFAULT_CASES
    report = []
    for question, expect_grounded, expected_source in cases:
        result = agent.answer(session, question)

        if expect_grounded:
            if not result.grounded:
                raise HarnessError(f"expected grounded answer for: {question}")
            if not result.citations:
                raise HarnessError(f"grounded answer carried no citations: {question}")
            for citation in result.citations:
                if not citation.source_path:
                    raise HarnessError(f"citation missing source metadata: {question}")
            if expected_source and not any(
                expected_source in c.source_path for c in result.citations
            ):
                raise HarnessError(
                    f"expected source {expected_source} not cited for: {question}"
                )
        else:
            if result.grounded:
                raise HarnessError(f"expected no grounded answer for: {question}")
            if result.citations:
                raise HarnessError(f"ungrounded answer must not carry citations: {question}")
            if result.text != NO_SOURCES_MESSAGE:
                raise HarnessError(f"ungrounded answer must say it has no source: {question}")

        report.append((question, result.grounded, [c.source_path for c in result.citations]))
    return report


def _build_mock_agent():
    from .llm import MockLLMClient
    from .mock import FakeKnowledgeBaseClient

    retrieval = RetrievalTool(FakeKnowledgeBaseClient(), "kb-mock", rerank_model_arn="arn:mock:rerank")
    return Agent(retrieval, llm=MockLLMClient())


def _build_live_agent(args):
    import boto3

    from .llm import BedrockLLMClient

    region = args.region or os.environ.get("AWS_REGION")
    kb_id = args.knowledge_base_id or os.environ.get("HOMEBASE_KB_ID")
    if not kb_id:
        raise SystemExit("live mode needs --knowledge-base-id (or $HOMEBASE_KB_ID)")

    agent_runtime = boto3.client("bedrock-agent-runtime", region_name=region) if region else boto3.client("bedrock-agent-runtime")
    runtime = boto3.client("bedrock-runtime", region_name=region) if region else boto3.client("bedrock-runtime")

    retrieval = RetrievalTool(agent_runtime, kb_id, rerank_model_arn=args.rerank_model_arn)
    llm = BedrockLLMClient(runtime, args.model_id)
    return Agent(retrieval, llm=llm)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="homebase-agent-harness")
    parser.add_argument("--mode", choices=["mock", "live"], default="mock")
    parser.add_argument("--tenant-id", default="tenant-demo")
    parser.add_argument("--user-id", default="user-demo")
    parser.add_argument("--knowledge-base-id", default=os.environ.get("HOMEBASE_KB_ID"))
    parser.add_argument("--rerank-model-arn", default=os.environ.get("HOMEBASE_RERANK_MODEL_ARN"))
    parser.add_argument("--model-id", default=os.environ.get("HOMEBASE_MODEL_ID", "anthropic.claude-placeholder"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION"))
    return parser


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    agent = _build_mock_agent() if args.mode == "mock" else _build_live_agent(args)
    session = Session(session_id="harness-session", user_id=args.user_id, tenant_id=args.tenant_id)

    report = run_harness(agent, session)

    print(f"agent harness ({args.mode}): {len(report)} cases, citations asserted")
    for question, grounded, sources in report:
        tag = "grounded" if grounded else "no-source"
        print(f"  [{tag}] {question}")
        for src in sources:
            print(f"      cite: {src}")
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
