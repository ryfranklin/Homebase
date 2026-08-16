"""LLM clients.

The generation step is behind an interface so the harness and unit tests run in
mock mode with no Bedrock calls. The Bedrock model id is a variable, so Opus vs
Sonnet is a config change, not a code change.
"""

from __future__ import annotations

import json
from typing import Protocol


def assemble_tool_stream(events):
    """Consume a Bedrock converse_stream event stream and yield normalized events
    for the streaming tool loop:

      {"type": "text", "text": <delta>}         for each streamed text delta
      {"type": "final", "message": <assistant message>, "stop_reason": <str>}  once

    The final message reassembles the content blocks (text plus toolUse blocks with
    their accumulated JSON input) so the tool loop can append it and continue.
    """
    blocks: dict = {}
    order: list = []
    stop_reason = None

    def touch(idx):
        if idx not in order:
            order.append(idx)

    for event in events:
        if "contentBlockStart" in event:
            e = event["contentBlockStart"]
            idx = e["contentBlockIndex"]
            start = e.get("start", {}) or {}
            if "toolUse" in start:
                tu = start["toolUse"]
                blocks[idx] = {"kind": "tool", "toolUseId": tu["toolUseId"], "name": tu["name"], "input": ""}
            else:
                blocks[idx] = {"kind": "text", "text": ""}
            touch(idx)
        elif "contentBlockDelta" in event:
            e = event["contentBlockDelta"]
            idx = e["contentBlockIndex"]
            delta = e.get("delta", {}) or {}
            blk = blocks.setdefault(idx, {"kind": "text", "text": ""})
            touch(idx)
            if "text" in delta:
                blk["kind"] = "text"
                blk["text"] = blk.get("text", "") + delta["text"]
                yield {"type": "text", "text": delta["text"]}
            elif "toolUse" in delta:
                blk["kind"] = "tool"
                blk["input"] = blk.get("input", "") + delta["toolUse"].get("input", "")
        elif "messageStop" in event:
            stop_reason = event["messageStop"].get("stopReason")
        # messageStart, contentBlockStop, metadata: nothing to accumulate.

    content = []
    for idx in order:
        blk = blocks[idx]
        if blk["kind"] == "text":
            content.append({"text": blk.get("text", "")})
        else:
            try:
                parsed = json.loads(blk.get("input") or "{}")
            except ValueError:
                parsed = {}
            content.append({"toolUse": {"toolUseId": blk["toolUseId"], "name": blk["name"], "input": parsed}})

    yield {"type": "final", "message": {"role": "assistant", "content": content}, "stop_reason": stop_reason}


def _passages_block(passages) -> str:
    lines = []
    for i, p in enumerate(passages, start=1):
        lines.append(f"[{i}] source: {p.source_path}\n{p.text}")
    return "\n\n".join(lines)


class LLMClient(Protocol):
    def generate(self, *, system: str, question: str, passages, session) -> str:
        ...

    def generate_general(self, *, system: str, question: str) -> str:
        """A general-knowledge answer with no retrieved passages (the ungrounded
        fallback). The caller labels it; this returns just the answer body."""
        ...

    def with_model(self, model_id: str) -> "LLMClient":
        """Return a client bound to a different model id, for a single request. The
        default model stays put; this is how the GUI's chosen default reaches Bedrock."""
        ...


class MockLLMClient:
    """Deterministic offline client. Grounds its answer in the passages and names
    their sources, so tests can assert citation behavior without Bedrock."""

    def generate(self, *, system, question, passages, session) -> str:
        sources = ", ".join(p.source_path for p in passages)
        return f"Based on {len(passages)} source(s) ({sources}), here is the answer to: {question}"

    def generate_general(self, *, system, question) -> str:
        return f"General answer to: {question}"

    def with_model(self, model_id):
        # The mock ignores the model id (offline, deterministic).
        return self


class BedrockLLMClient:
    """Claude on Bedrock via the Converse API. Model id is injected.

    Not exercised by the unit tests. Confirm the Converse request shape against
    the bedrock-runtime API version in your region before relying on it.
    """

    def __init__(self, client, model_id, *, max_tokens=1024, temperature=0.0, guardrail=None):
        self._client = client
        self._model_id = model_id
        self._max_tokens = max_tokens
        self._temperature = temperature
        # A Bedrock Guardrail applied to every model call (input + output), so the same
        # governance protects all doors (GUI, CLI, Slack). guardrail is
        # {"guardrailIdentifier", "guardrailVersion"} or None (unset -> no guardrail).
        self._gc = {"guardrailConfig": guardrail} if guardrail else {}

    def with_model(self, model_id):
        # A lightweight clone sharing the boto3 client, guardrail and inference config,
        # bound to a different model id. Immutable, so it is safe under concurrency.
        return BedrockLLMClient(
            self._client,
            model_id,
            max_tokens=self._max_tokens,
            temperature=self._temperature,
            guardrail=(self._gc.get("guardrailConfig") if self._gc else None),
        )

    def generate(self, *, system, question, passages, session) -> str:
        context = _passages_block(passages)
        user_text = (
            f"Question: {question}\n\n"
            f"Use only these retrieved passages and cite their sources:\n\n{context}"
        )
        response = self._client.converse(
            modelId=self._model_id,
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": user_text}]}],
            inferenceConfig={"maxTokens": self._max_tokens, "temperature": self._temperature},
            **self._gc,
        )
        parts = response["output"]["message"]["content"]
        return "".join(part.get("text", "") for part in parts)

    def generate_general(self, *, system, question) -> str:
        # No retrieved passages: a plain general-knowledge answer. The guardrail still
        # applies, and the caller stamps the "not from your knowledge base" disclaimer.
        response = self._client.converse(
            modelId=self._model_id,
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": question}]}],
            inferenceConfig={"maxTokens": self._max_tokens, "temperature": self._temperature},
            **self._gc,
        )
        parts = response["output"]["message"]["content"]
        return "".join(part.get("text", "") for part in parts)

    def converse_with_tools(self, *, system, messages, tools):
        """One Converse turn with a tool config, normalized for the tool loop:
        returns {"message": <assistant message>, "stop_reason": <str>}."""
        response = self._client.converse(
            modelId=self._model_id,
            system=[{"text": system}],
            messages=messages,
            toolConfig={"tools": tools},
            inferenceConfig={"maxTokens": self._max_tokens, "temperature": self._temperature},
            **self._gc,
        )
        return {
            "message": response["output"]["message"],
            "stop_reason": response.get("stopReason"),
        }

    def converse_with_tools_stream(self, *, system, messages, tools):
        """Streaming variant of converse_with_tools: yields the normalized events
        from assemble_tool_stream (text deltas, then one final message)."""
        response = self._client.converse_stream(
            modelId=self._model_id,
            system=[{"text": system}],
            messages=messages,
            toolConfig={"tools": tools},
            inferenceConfig={"maxTokens": self._max_tokens, "temperature": self._temperature},
            **self._gc,
        )
        yield from assemble_tool_stream(response["stream"])
