"""A minimal Converse tool-use loop.

Drives a tool-capable LLM (anything with converse_with_tools) until it stops asking
for tools, executing each requested tool via an injected `execute` callback. Kept
pure and client-agnostic so it is unit-tested with a scripted fake LLM and no AWS.

`execute(name, tool_input) -> Outcome` returns:
  - result: the JSON-able dict fed back to the model as the tool result,
  - citations: any citations the tool produced (knowledge base search), and
  - authorization_url: set when a connector needs the user to link their account,
    which short-circuits the loop into a consent prompt.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Outcome:
    result: dict
    citations: list = field(default_factory=list)
    authorization_url: str | None = None


@dataclass(frozen=True)
class ToolLoopResult:
    text: str
    citations: list = field(default_factory=list)
    grounded: bool = False
    authorization_url: str | None = None


def _text_of(message) -> str:
    return "".join(b.get("text", "") for b in message.get("content", []) if "text" in b)


def _consent_text(url) -> str:
    return (
        "To do that I need access to that account. Please connect it by opening this "
        f"link and approving access, then ask me again:\n\n{url}"
    )


def run_tool_loop(llm, *, system, question, tools, execute, max_turns=8) -> ToolLoopResult:
    messages = [{"role": "user", "content": [{"text": question}]}]
    citations: list = []
    grounded = False

    for _ in range(max_turns):
        out = llm.converse_with_tools(system=system, messages=messages, tools=tools)
        message = out["message"]
        messages.append(message)

        if out.get("stop_reason") != "tool_use":
            return ToolLoopResult(text=_text_of(message), citations=citations, grounded=grounded)

        tool_results = []
        for block in message.get("content", []):
            tool_use = block.get("toolUse")
            if not tool_use:
                continue
            outcome = execute(tool_use["name"], tool_use.get("input") or {})

            if outcome.authorization_url:
                return ToolLoopResult(
                    text=_consent_text(outcome.authorization_url),
                    citations=citations,
                    grounded=grounded,
                    authorization_url=outcome.authorization_url,
                )
            if outcome.citations:
                citations.extend(outcome.citations)
                grounded = True

            tool_results.append(
                {
                    "toolResult": {
                        "toolUseId": tool_use["toolUseId"],
                        "content": [{"json": outcome.result}],
                    }
                }
            )

        messages.append({"role": "user", "content": tool_results})

    return ToolLoopResult(
        text="I couldn't complete that within a reasonable number of steps. Please try rephrasing.",
        citations=citations,
        grounded=grounded,
    )


def run_tool_loop_stream(llm, *, system, question, tools, execute, max_turns=8):
    """Streaming tool loop. A generator that yields SSE-ready events as they happen:

      {"type": "token", "text": ...}                streamed answer text
      {"type": "citation", "source_path": ..., "score": ...}   from knowledge-base search
      {"type": "authorization_required", "url": ...}  a connector needs linking
      {"type": "done"}                              terminal

    Text is streamed live from the model; tool calls execute between turns.
    """
    messages = [{"role": "user", "content": [{"text": question}]}]

    for _ in range(max_turns):
        final = None
        for ev in llm.converse_with_tools_stream(system=system, messages=messages, tools=tools):
            if ev["type"] == "text":
                yield {"type": "token", "text": ev["text"]}
            elif ev["type"] == "final":
                final = ev

        message = final["message"] if final else {"role": "assistant", "content": []}
        messages.append(message)

        if not final or final.get("stop_reason") != "tool_use":
            yield {"type": "done"}
            return

        tool_results = []
        for block in message.get("content", []):
            tool_use = block.get("toolUse")
            if not tool_use:
                continue
            # Announce which source is being pulled so the UI's live source tree lights
            # up (search_knowledge_base -> Vault, gcal_list_events -> Calendar, etc.).
            yield {"type": "tool_call", "name": tool_use["name"]}
            outcome = execute(tool_use["name"], tool_use.get("input") or {})

            if outcome.authorization_url:
                yield {"type": "token", "text": _consent_text(outcome.authorization_url)}
                yield {"type": "authorization_required", "url": outcome.authorization_url}
                yield {"type": "done"}
                return
            for citation in outcome.citations:
                yield {"type": "citation", "source_path": citation.source_path, "score": citation.score}

            tool_results.append(
                {"toolResult": {"toolUseId": tool_use["toolUseId"], "content": [{"json": outcome.result}]}}
            )

        messages.append({"role": "user", "content": tool_results})

    yield {"type": "token", "text": "I couldn't complete that within a reasonable number of steps."}
    yield {"type": "done"}
