"""AgentCore Runtime HTTP contract.

An AgentCore Runtime container serves POST /invocations and GET /ping on port
8080. This module wires the agent behind that contract. Real Bedrock clients are
built lazily from environment variables, so importing this module makes no AWS
calls.

Configuration (all non-secret identifiers, resolved from SSM at deploy time and
passed as env vars):
  HOMEBASE_KB_ID, HOMEBASE_RERANK_MODEL_ARN, HOMEBASE_MODEL_ID,
  HOMEBASE_MEMORY_ID, AWS_REGION.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from .agent import Agent
from .retrieval import RetrievalTool
from .session import Session

PORT = 8080


def build_agent_from_env():
    import boto3

    from .llm import BedrockLLMClient
    from .memory import AgentCoreMemory, NullMemory

    region = os.environ.get("AWS_REGION")
    kb_id = os.environ["HOMEBASE_KB_ID"]
    model_id = os.environ["HOMEBASE_MODEL_ID"]
    rerank_arn = os.environ.get("HOMEBASE_RERANK_MODEL_ARN")
    memory_id = os.environ.get("HOMEBASE_MEMORY_ID")

    def client(name):
        return boto3.client(name, region_name=region) if region else boto3.client(name)

    retrieval = RetrievalTool(client("bedrock-agent-runtime"), kb_id, rerank_model_arn=rerank_arn)
    llm = BedrockLLMClient(client("bedrock-runtime"), model_id)
    memory = AgentCoreMemory(client("bedrock-agentcore"), memory_id) if memory_id else NullMemory()
    return Agent(retrieval, llm=llm, memory=memory)


def _session_from_payload(payload: dict) -> Session:
    # Identity is taken from the authenticated request context (the BFF passes
    # the verified user and tenant); tenant_id stays explicit.
    return Session(
        session_id=payload.get("session_id", "unknown-session"),
        user_id=payload.get("user_id", "unknown-user"),
        tenant_id=payload.get("tenant_id", "unknown-tenant"),
    )


def make_handler(agent):
    class Handler(BaseHTTPRequestHandler):
        def _json(self, status, body):
            data = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/ping":
                self._json(200, {"status": "healthy"})
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/invocations":
                self._json(404, {"error": "not found"})
                return
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            session = _session_from_payload(payload)
            question = payload.get("input") or payload.get("prompt") or ""
            result = agent.answer(session, question)
            self._json(
                200,
                {
                    "answer": result.text,
                    "grounded": result.grounded,
                    "citations": [
                        {"source_path": c.source_path, "score": c.score, "metadata": c.metadata}
                        for c in result.citations
                    ],
                },
            )

        def log_message(self, format, *args):  # keep the container logs quiet
            return

    return Handler


def main() -> int:
    server = HTTPServer(("0.0.0.0", PORT), make_handler(build_agent_from_env()))
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
