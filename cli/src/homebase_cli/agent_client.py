"""Invoke the AgentCore runtime with streaming.

Same InvokeAgentRuntime contract as the BFF, so the CLI has behavior parity with
the GUI: same agent, same streamed events. The boto3 client is injected, so the
unit tests use a fake and make no AWS calls. The CLI never touches the knowledge
base, S3, or Secrets Manager directly: retrieval happens inside the agent.
"""

from __future__ import annotations

import json

SESSION_HEADER = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"


def parse_sse(byte_chunks):
    """Decode a stream of byte chunks (SSE) into event dicts."""
    buffer = ""
    for chunk in byte_chunks:
        if isinstance(chunk, (bytes, bytearray)):
            buffer += chunk.decode("utf-8", errors="replace")
        else:
            buffer += str(chunk)
        while "\n\n" in buffer:
            raw, buffer = buffer.split("\n\n", 1)
            data_line = next((l for l in raw.splitlines() if l.startswith("data:")), None)
            if data_line is None:
                continue
            payload = data_line[len("data:"):].strip()
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                yield {"type": "token", "text": payload}


def _byte_chunks(response):
    """Yield byte chunks from an InvokeAgentRuntime response body, tolerating the
    StreamingBody / iterable shapes boto3 may return."""
    body = response.get("response", response)
    if hasattr(body, "iter_chunks"):
        yield from body.iter_chunks()
    elif hasattr(body, "read"):
        yield body.read()
    else:
        yield from body


class AgentRuntimeClient:
    def __init__(self, client, runtime_arn):
        self._client = client
        self._runtime_arn = runtime_arn

    def stream(self, session, prompt):
        payload = {
            "input": prompt,
            "session_id": session.session_id,
            "user_id": session.user_id,
            "tenant_id": session.tenant_id,
        }
        response = self._client.invoke_agent_runtime(
            agentRuntimeArn=self._runtime_arn,
            runtimeSessionId=session.session_id,
            contentType="application/json",
            accept="text/event-stream",
            payload=json.dumps(payload).encode("utf-8"),
        )
        yield from parse_sse(_byte_chunks(response))
