"""LLM clients.

The generation step is behind an interface so the harness and unit tests run in
mock mode with no Bedrock calls. The Bedrock model id is a variable, so Opus vs
Sonnet is a config change, not a code change.
"""

from __future__ import annotations

from typing import Protocol


def _passages_block(passages) -> str:
    lines = []
    for i, p in enumerate(passages, start=1):
        lines.append(f"[{i}] source: {p.source_path}\n{p.text}")
    return "\n\n".join(lines)


class LLMClient(Protocol):
    def generate(self, *, system: str, question: str, passages, session) -> str:
        ...


class MockLLMClient:
    """Deterministic offline client. Grounds its answer in the passages and names
    their sources, so tests can assert citation behavior without Bedrock."""

    def generate(self, *, system, question, passages, session) -> str:
        sources = ", ".join(p.source_path for p in passages)
        return f"Based on {len(passages)} source(s) ({sources}), here is the answer to: {question}"


class BedrockLLMClient:
    """Claude on Bedrock via the Converse API. Model id is injected.

    Not exercised by the unit tests. Confirm the Converse request shape against
    the bedrock-runtime API version in your region before relying on it.
    """

    def __init__(self, client, model_id, *, max_tokens=1024, temperature=0.0):
        self._client = client
        self._model_id = model_id
        self._max_tokens = max_tokens
        self._temperature = temperature

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
        )
        parts = response["output"]["message"]["content"]
        return "".join(part.get("text", "") for part in parts)
