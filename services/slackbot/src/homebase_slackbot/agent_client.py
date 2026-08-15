"""Invoke the Homebase AgentCore runtime and return a single assembled answer.

The wire contract matches the agent's HTTP server (services/agent, POST
/invocations): the request payload is {input, session_id, user_id, tenant_id}.
The response is EITHER a JSON object {answer, grounded, citations,
authorization_url} (the buffered path) OR a Server-Sent Events stream of
{type: token|citation|authorization_required|done, ...} events (the tool-loop
path, which is what the connector-enabled prod agent serves).

Slack posts a single message, so this client reads the whole response and
assembles a final AgentReply regardless of which shape came back. Identity is
presented by this bridge (the resolved Slack user's email + tenant), matching
the agent's Session model, exactly as the ssh-chat CLI does.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field


@dataclass
class AgentReply:
    answer: str
    grounded: bool = True
    citations: list = field(default_factory=list)
    authorization_url: str | None = None


def session_id_for(channel: str, thread: str | None) -> str:
    """A stable AgentCore runtimeSessionId for a Slack conversation.

    Reusing one id per channel+thread lets the agent keep conversation memory
    across a threaded exchange. AgentCore requires >= 33 chars; the prefixed
    sha1 hex is 45.
    """
    key = f"{channel}:{thread or channel}".encode("utf-8")
    return f"homebase-slack-{hashlib.sha1(key).hexdigest()}"


def _parse_sse(body: bytes) -> AgentReply:
    """Assemble an AgentReply from the agent's SSE event stream."""
    text_parts: list[str] = []
    citations: list[dict] = []
    authorization_url: str | None = None
    grounded = True

    for raw in body.decode("utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        try:
            event = json.loads(line[len("data:") :].strip())
        except ValueError:
            continue
        etype = event.get("type")
        if etype == "token":
            text_parts.append(event.get("text", ""))
        elif etype == "citation":
            citations.append({"source_path": event.get("source_path"), "score": event.get("score")})
        elif etype in ("authorization_required", "authorization"):
            authorization_url = event.get("authorization_url") or authorization_url
        elif etype == "error":
            grounded = False

    return AgentReply(
        answer="".join(text_parts),
        grounded=grounded,
        citations=citations,
        authorization_url=authorization_url,
    )


def _parse_json(body: bytes) -> AgentReply:
    data = json.loads(body or b"{}")
    return AgentReply(
        answer=data.get("answer", ""),
        grounded=data.get("grounded", True),
        citations=data.get("citations") or [],
        authorization_url=data.get("authorization_url"),
    )


def parse_response(body: bytes, content_type: str | None = None) -> AgentReply:
    """Assemble an AgentReply from a raw runtime response body.

    The agent streams SSE when connectors are enabled (the prod path) and returns
    JSON otherwise. Detect by content type first, then fall back to sniffing the
    body so this is robust to a runtime that does not echo the content type.
    """
    ct = (content_type or "").lower()
    head = body.lstrip()[:5].lower() if body else b""
    if "event-stream" in ct or head.startswith(b"data:"):
        return _parse_sse(body)
    return _parse_json(body)


def _default_client(region: str | None):
    import boto3

    if region:
        return boto3.client("bedrock-agentcore", region_name=region)
    return boto3.client("bedrock-agentcore")


class AgentClient:
    """Thin wrapper over InvokeAgentRuntime.

    Pass `client` to inject a fake in tests; otherwise a real boto3
    bedrock-agentcore client is built lazily (so importing this module makes no
    AWS calls).
    """

    def __init__(self, runtime_arn, tenant_id, region=None, client=None):
        self._runtime_arn = runtime_arn
        self._tenant_id = tenant_id
        self._client = client if client is not None else _default_client(region)

    def ask(self, prompt, *, user_id, session_id) -> AgentReply:
        payload = json.dumps(
            {
                "input": prompt,
                "session_id": session_id,
                "user_id": user_id,
                "tenant_id": self._tenant_id,
            }
        ).encode("utf-8")

        response = self._client.invoke_agent_runtime(
            agentRuntimeArn=self._runtime_arn,
            runtimeSessionId=session_id,
            contentType="application/json",
            accept="application/json",
            payload=payload,
        )
        body = response["response"].read()
        content_type = response.get("contentType")
        return parse_response(body, content_type)
