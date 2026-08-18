"""Targets for the generation eval: the things under test.

A target takes a GenCase and returns a ModelResponse. Targets are duck-typed
(like the retrievers in retrievers.py): anything with a ``model_id`` attribute
and a ``generate(case) -> ModelResponse`` method works.

BedrockConverseTarget is the core of the multi-model harness. It speaks the
Bedrock **Converse** API, which is model-agnostic: the same code drives Claude,
GLM, Kimi, Qwen, Llama, DeepSeek, Nova, and Mistral. That is what lets one suite
run across every model without per-provider request shapes.

The judge is itself a target (see scorers.score_quality), so the offline tests
judge with a MockModelTarget and never touch AWS.
"""

from __future__ import annotations

import time

from .gen_models import ModelResponse


class MockModelTarget:
    """Offline, deterministic target for tests and no-AWS demos.

    By default it echoes a canned answer derived from the case, with fixed token
    counts and latency so scoring is reproducible. Pass ``responder`` (a callable
    of the case returning a string) to shape the answer per case, e.g. to make one
    model "win" in a demo.
    """

    def __init__(
        self,
        model_id,
        *,
        responder=None,
        input_tokens: int = 100,
        output_tokens: int = 50,
        latency_ms: float = 10.0,
        ok: bool = True,
        error: str = "",
    ):
        self.model_id = model_id
        self._responder = responder
        self._input_tokens = input_tokens
        self._output_tokens = output_tokens
        self._latency_ms = latency_ms
        self._ok = ok
        self._error = error

    def generate(self, case) -> ModelResponse:
        if not self._ok:
            return ModelResponse(text="", ok=False, error=self._error, latency_ms=self._latency_ms)
        text = self._responder(case) if self._responder else f"[{self.model_id}] {case.prompt}"
        return ModelResponse(
            text=text,
            input_tokens=self._input_tokens,
            output_tokens=self._output_tokens,
            latency_ms=self._latency_ms,
            ok=True,
        )


class BedrockConverseTarget:
    """Live target: one Bedrock model via the Converse API.

    Model-agnostic by design. ``model_id`` is any Converse-capable model id or
    inference profile (for example ``us.anthropic.claude-opus-4-8``, ``zai.glm-5``,
    ``moonshotai.kimi-k2.5``, ``qwen.qwen3-coder-next``). The caller supplies the
    boto3 ``bedrock-runtime`` client so credentials and region come from the
    instance role or the ambient profile, never from here.

    Latency is wall-clock around the single Converse call. Token usage comes from
    the response ``usage`` block, which Converse normalizes across providers.
    """

    def __init__(self, client, model_id, *, max_tokens: int = 1024, temperature: float = 0.0, clock=None):
        self._client = client
        self.model_id = model_id
        self._max_tokens = max_tokens
        self._temperature = temperature
        # Injectable monotonic clock keeps the live path testable without sleeping.
        self._clock = clock or time.perf_counter

    def _build_request(self, case):
        request = {
            "modelId": self.model_id,
            "messages": [{"role": "user", "content": [{"text": case.prompt}]}],
            "inferenceConfig": {"maxTokens": self._max_tokens, "temperature": self._temperature},
        }
        if case.system:
            request["system"] = [{"text": case.system}]
        return request

    def generate(self, case) -> ModelResponse:
        request = self._build_request(case)
        started = self._clock()
        try:
            response = self._client.converse(**request)
        except Exception as exc:  # noqa: BLE001 - a failed call is a scored miss, not a crash
            elapsed_ms = (self._clock() - started) * 1000.0
            return ModelResponse(text="", ok=False, error=f"{type(exc).__name__}: {exc}", latency_ms=elapsed_ms)

        elapsed_ms = (self._clock() - started) * 1000.0
        text = _extract_text(response)
        usage = response.get("usage", {})
        return ModelResponse(
            text=text,
            input_tokens=int(usage.get("inputTokens", 0)),
            output_tokens=int(usage.get("outputTokens", 0)),
            latency_ms=elapsed_ms,
            ok=True,
        )


def _extract_text(response) -> str:
    """Pull the assistant text out of a Converse response.

    Converse returns output.message.content as a list of blocks; concatenate the
    text blocks. Reasoning-only models (for example DeepSeek R1) may put content
    in a reasoning block and leave text empty, which scores as a low-quality miss
    rather than an error.
    """
    blocks = response.get("output", {}).get("message", {}).get("content", [])
    parts = [b["text"] for b in blocks if isinstance(b, dict) and "text" in b]
    return "".join(parts).strip()
