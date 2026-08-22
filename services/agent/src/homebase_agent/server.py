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
    # A Bedrock Guardrail applied to every model call when configured, governing all
    # doors (GUI, CLI, Slack) in one place. Absent -> no guardrail.
    guardrail_id = os.environ.get("HOMEBASE_GUARDRAIL_ID")
    guardrail = (
        {"guardrailIdentifier": guardrail_id, "guardrailVersion": os.environ.get("HOMEBASE_GUARDRAIL_VERSION", "DRAFT")}
        if guardrail_id
        else None
    )

    def client(name):
        return boto3.client(name, region_name=region) if region else boto3.client(name)

    retrieval = RetrievalTool(client("bedrock-agent-runtime"), kb_id, rerank_model_arn=rerank_arn)
    llm = BedrockLLMClient(client("bedrock-runtime"), model_id, guardrail=guardrail)
    memory = AgentCoreMemory(client("bedrock-agentcore"), memory_id) if memory_id else NullMemory()

    # Connectors are opt-in: when the shim name prefix is set, the agent gets a
    # tool-use loop with the connector read tools alongside knowledge-base search.
    connector_prefix = os.environ.get("HOMEBASE_CONNECTOR_PREFIX")
    connectors = None
    if connector_prefix:
        from .connectors import ConnectorClient

        connectors = ConnectorClient(client("lambda"), connector_prefix)

    # Models a chat request may select (the GUI's settings-level default). The default
    # model is always allowed; extras come from HOMEBASE_ALLOWED_MODEL_IDS (comma-sep).
    # A request for anything outside this set falls back to the default (see Agent).
    allowed_models = {model_id} | {
        m.strip() for m in os.environ.get("HOMEBASE_ALLOWED_MODEL_IDS", "").split(",") if m.strip()
    }

    return Agent(retrieval, llm=llm, memory=memory, connectors=connectors, allowed_models=allowed_models)


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

        def _sse(self, event):
            self.wfile.write(f"data: {json.dumps(event)}\n\n".encode("utf-8"))
            self.wfile.flush()

        def do_POST(self):
            if self.path != "/invocations":
                self._json(404, {"error": "not found"})
                return
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            session = _session_from_payload(payload)
            question = payload.get("input") or payload.get("prompt") or ""
            # Plan mode runs the AI-DLC INCEPTION interview and emits a flight-plan
            # draft; author mode runs the document-authoring interview and emits a
            # homebase-note draft; any other value is the normal grounded-answer mode.
            mode = payload.get("mode")
            planning = mode == "plan"
            authoring = mode == "author"
            # Optional model choice (the GUI's settings-level default). The agent
            # validates it against the allow-list and ignores anything unknown.
            model = payload.get("model") or None
            # Chat scope: 'vault' answers strictly from the KB + connectors (no general
            # knowledge); anything else (default) is the normal grounded-with-fallback mode.
            scope = "vault" if payload.get("scope") == "vault" else "general"
            # In plan mode, the current flight plan being revised (JSON string). Folded
            # into the operator's turn so the agent edits it; ignored outside plan mode.
            plan_context = payload.get("plan_context") if planning else None
            # In author mode, the document being written (target path, topic, and the
            # chosen template on turn one or the current draft on later turns), as a JSON
            # string. Folded into the turn so the agent fills/refines it; ignored otherwise.
            author_context = payload.get("author_context") if authoring else None

            # Stream the answer token-by-token when the agent supports it (the tool
            # loop). The BFF consumes this SSE and relays it to the browser.
            if agent.supports_streaming():
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                try:
                    for event in agent.answer_stream(session, question, planning=planning, authoring=authoring, model=model, scope=scope, plan_context=plan_context, author_context=author_context):
                        self._sse(event)
                except Exception:  # noqa: BLE001 - never leave the stream hanging
                    self._sse({"type": "error", "message": "agent_error"})
                    self._sse({"type": "done"})
                return

            # Non-streaming fallback (no connectors, e.g. tests/RAG-only).
            result = agent.answer(session, question, planning=planning, authoring=authoring, model=model, scope=scope, plan_context=plan_context, author_context=author_context)
            body = {
                "answer": result.text,
                "grounded": result.grounded,
                "citations": [
                    {"source_path": c.source_path, "score": c.score, "metadata": c.metadata}
                    for c in result.citations
                ],
            }
            if getattr(result, "authorization_url", None):
                body["authorization_url"] = result.authorization_url
            self._json(200, body)

        def log_message(self, format, *args):  # keep the container logs quiet
            return

    return Handler


def main() -> int:
    server = HTTPServer(("0.0.0.0", PORT), make_handler(build_agent_from_env()))
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
