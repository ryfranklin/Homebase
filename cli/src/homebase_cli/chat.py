"""Terminal chat entry point.

One-shot (--prompt) or an interactive REPL. The agent client is built lazily from
the injected/real boto3 client, so importing this module makes no AWS call.
"""

from __future__ import annotations

import argparse
import os
import sys

from .agent_client import AgentRuntimeClient
from .config import load_config
from .render import render_stream
from .session import Session


def converse_once(client, session, prompt, out):
    """Stream one turn and render it. Returns whether the answer was grounded."""
    return render_stream(client.stream(session, prompt), out)


def _make_client(config):
    import boto3

    low_level = (
        boto3.client("bedrock-agentcore", region_name=config.region)
        if config.region
        else boto3.client("bedrock-agentcore")
    )
    return AgentRuntimeClient(low_level, config.runtime_arn)


def build_arg_parser():
    parser = argparse.ArgumentParser(prog="homebase-cli", description="Terminal chat with the Homebase agent.")
    parser.add_argument("--prompt", help="One-shot prompt; omit for an interactive session.")
    parser.add_argument("--session-id", default=None, help="Session id (defaults to tenant:user).")
    return parser


def _repl(client, session, out, stdin):
    out.write("Homebase chat. Type your message, or Ctrl-D to exit.\n")
    out.flush()
    for line in stdin:
        prompt = line.strip()
        if not prompt:
            continue
        out.write("\n")
        converse_once(client, session, prompt, out)
        out.write("\n> ")
        out.flush()
    out.write("\n")


def main(argv=None, *, client=None, out=None, stdin=None, env=None):
    args = build_arg_parser().parse_args(argv)
    env = env if env is not None else os.environ
    out = out or sys.stdout
    stdin = stdin or sys.stdin

    config = load_config(env)
    session = Session(
        session_id=args.session_id or f"{config.tenant_id}:{config.user_id}",
        user_id=config.user_id,
        tenant_id=config.tenant_id,
    )
    client = client or _make_client(config)

    if args.prompt:
        converse_once(client, session, args.prompt, out)
    else:
        _repl(client, session, out, stdin)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
