"""Invoke the Homebase AgentCore runtime and return its JSON result.

The wire contract matches the agent's HTTP server (services/agent, POST
/invocations): the request payload is {input, session_id, user_id, tenant_id}
and the response is {answer, grounded, citations}. Identity is presented by this
CLI task (it is not taken from any client), matching the agent's Session model.
"""

from __future__ import annotations

import json
import uuid


def new_session_id() -> str:
    # AgentCore runtimeSessionId must be reasonably long (>= 33 chars); the
    # prefixed uuid4 hex is 45 characters.
    return f"homebase-cli-{uuid.uuid4().hex}"


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

    def __init__(self, runtime_arn, user_id, tenant_id, region=None, client=None):
        self._runtime_arn = runtime_arn
        self._user_id = user_id
        self._tenant_id = tenant_id
        self._client = client if client is not None else _default_client(region)

    def ask(self, prompt, session_id=None) -> dict:
        session_id = session_id or new_session_id()
        payload = json.dumps(
            {
                "input": prompt,
                "session_id": session_id,
                "user_id": self._user_id,
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
        return json.loads(body or b"{}")
