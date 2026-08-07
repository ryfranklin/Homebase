"""homebase-cli entrypoint.

Usage (inside the ssh-chat Fargate task, reached via ECS Exec):

    homebase-cli                 # interactive REPL (one session for the run)
    homebase-cli --prompt "..."  # one-shot

Configuration comes from the task's environment:
    HOMEBASE_AGENT_RUNTIME_ARN   (required)
    HOMEBASE_USER_ID, HOMEBASE_TENANT_ID   (identity presented to the agent)
    AWS_REGION
"""

from __future__ import annotations

import argparse
import os
import sys

from .client import AgentClient, new_session_id


def _client_from_env() -> AgentClient:
    try:
        runtime_arn = os.environ["HOMEBASE_AGENT_RUNTIME_ARN"]
    except KeyError:
        raise SystemExit("HOMEBASE_AGENT_RUNTIME_ARN is not set")
    return AgentClient(
        runtime_arn,
        os.environ.get("HOMEBASE_USER_ID", "unknown-user"),
        os.environ.get("HOMEBASE_TENANT_ID", "unknown-tenant"),
        region=os.environ.get("AWS_REGION"),
    )


def _print_result(result: dict) -> None:
    print(result.get("answer", ""))

    citations = result.get("citations") or []
    if citations:
        print("\nSources:")
        for c in citations:
            source = c.get("source_path", "?")
            score = c.get("score")
            suffix = f"  ({score:.3f})" if isinstance(score, (int, float)) else ""
            print(f"  - {source}{suffix}")

    if result.get("grounded") is False:
        print("\n(no relevant source found in the knowledge base)")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="homebase-cli",
        description="Homebase thin chat CLI (talks to the AgentCore agent runtime).",
    )
    parser.add_argument("--prompt", help="One-shot question. Omit for an interactive REPL.")
    args = parser.parse_args(argv)

    client = _client_from_env()

    if args.prompt is not None:
        _print_result(client.ask(args.prompt))
        return 0

    # Interactive REPL: reuse one session id so the agent keeps conversation memory.
    session_id = new_session_id()
    print("homebase-cli — ask a question; Ctrl-D or 'exit' to quit.")
    while True:
        try:
            line = input("› ").strip()
        except EOFError:
            print()
            return 0
        if not line:
            continue
        if line in {"exit", "quit"}:
            return 0
        try:
            _print_result(client.ask(line, session_id=session_id))
        except Exception as exc:  # keep the REPL alive on transient errors
            print(f"error: {exc}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
