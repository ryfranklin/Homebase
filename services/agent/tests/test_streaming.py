import unittest

import _bootstrap  # noqa: F401

from homebase_agent.agent import Agent
from homebase_agent.llm import assemble_tool_stream
from homebase_agent.retrieval import Passage
from homebase_agent.session import Session

SYS = "sys"
SESSION = Session(session_id="s1", user_id="u1", tenant_id="homebase")


# --- assemble_tool_stream (raw Bedrock converse_stream events) ---------------
class AssembleStreamTests(unittest.TestCase):
    def test_text_deltas_stream_and_assemble(self):
        events = [
            {"messageStart": {"role": "assistant"}},
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Hel"}}},
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "lo"}}},
            {"contentBlockStop": {"contentBlockIndex": 0}},
            {"messageStop": {"stopReason": "end_turn"}},
        ]
        out = list(assemble_tool_stream(events))
        self.assertEqual([e for e in out if e["type"] == "text"], [{"type": "text", "text": "Hel"}, {"type": "text", "text": "lo"}])
        final = out[-1]
        self.assertEqual(final["stop_reason"], "end_turn")
        self.assertEqual(final["message"]["content"], [{"text": "Hello"}])

    def test_tool_use_input_is_accumulated_and_parsed(self):
        events = [
            {"contentBlockStart": {"contentBlockIndex": 0, "start": {"toolUse": {"toolUseId": "t1", "name": "slack_read_messages"}}}},
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": '{"chan'}}}},
            {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": 'nel":"general"}'}}}},
            {"contentBlockStop": {"contentBlockIndex": 0}},
            {"messageStop": {"stopReason": "tool_use"}},
        ]
        out = list(assemble_tool_stream(events))
        self.assertEqual([e for e in out if e["type"] == "text"], [])  # no text
        final = out[-1]
        self.assertEqual(final["stop_reason"], "tool_use")
        self.assertEqual(
            final["message"]["content"],
            [{"toolUse": {"toolUseId": "t1", "name": "slack_read_messages", "input": {"channel": "general"}}}],
        )


# --- scripted streaming LLM + tool loop --------------------------------------
def text_ev(t):
    return {"type": "text", "text": t}


def final_ev(content, stop):
    return {"type": "final", "message": {"role": "assistant", "content": content}, "stop_reason": stop}


class StreamingLLM:
    def __init__(self, turns):
        self._turns = list(turns)
        self.calls = []

    def converse_with_tools_stream(self, *, system, messages, tools):
        self.calls.append({"messages": [m for m in messages]})
        for ev in self._turns.pop(0):
            yield ev


class FakeRetrieval:
    def __init__(self, passages):
        self._passages = passages

    def retrieve(self, query, **kwargs):
        return self._passages


class FakeConnectors:
    def __init__(self, response):
        self._response = response
        self.calls = []

    def tool_specs(self):
        return [{"toolSpec": {"name": "slack_read_messages", "description": "x", "inputSchema": {"json": {"type": "object"}}}}]

    def tool_names(self):
        return {"slack_read_messages"}

    def call(self, name, arguments, tenant_id):
        self.calls.append((name, arguments, tenant_id))
        return self._response


def _agent(llm, connectors, passages=None):
    return Agent(FakeRetrieval(passages or []), llm=llm, system_prompt=SYS, connectors=connectors)


class StreamingToolLoopTests(unittest.TestCase):
    def test_streams_tokens_and_runs_a_connector_tool(self):
        llm = StreamingLLM([
            # turn 1: call the connector (no user-facing text)
            [final_ev([{"toolUse": {"toolUseId": "t1", "name": "slack_read_messages", "input": {"channel": "general"}}}], "tool_use")],
            # turn 2: stream the answer
            [text_ev("In "), text_ev("general: hi"), final_ev([{"text": "In general: hi"}], "end_turn")],
        ])
        connectors = FakeConnectors({"result": {"messages": [{"text": "hi"}]}})
        agent = _agent(llm, connectors)

        events = list(agent.answer_stream(SESSION, "what's in #general?"))
        tokens = "".join(e["text"] for e in events if e["type"] == "token")
        self.assertEqual(tokens, "In general: hi")
        self.assertEqual(events[-1], {"type": "done"})
        self.assertEqual(connectors.calls[0], ("slack_read_messages", {"channel": "general"}, "homebase"))
        # A tool_call event announces the source pulled, so the UI source tree lights up.
        self.assertIn({"type": "tool_call", "name": "slack_read_messages"}, events)

    def test_knowledge_base_emits_citation(self):
        llm = StreamingLLM([
            [final_ev([{"toolUse": {"toolUseId": "t1", "name": "search_knowledge_base", "input": {"query": "keys"}}}], "tool_use")],
            [text_ev("Rotate it."), final_ev([{"text": "Rotate it."}], "end_turn")],
        ])
        passages = [Passage(text="steps", source_path="ops/key-rotation.md", score=0.9)]
        agent = _agent(llm, FakeConnectors({}), passages=passages)

        events = list(agent.answer_stream(SESSION, "how to rotate the key?"))
        cites = [e for e in events if e["type"] == "citation"]
        self.assertEqual(cites, [{"type": "citation", "source_path": "ops/key-rotation.md", "score": 0.9}])

    def test_requires_authorization_streams_consent_then_done(self):
        llm = StreamingLLM([
            [final_ev([{"toolUse": {"toolUseId": "t1", "name": "slack_read_messages", "input": {}}}], "tool_use")],
        ])
        connectors = FakeConnectors({"requires_authorization": True, "authorization_url": "https://consent.example/x"})
        agent = _agent(llm, connectors)

        events = list(agent.answer_stream(SESSION, "read slack"))
        tokens = "".join(e["text"] for e in events if e["type"] == "token")
        self.assertIn("https://consent.example/x", tokens)
        self.assertTrue(any(e["type"] == "authorization_required" for e in events))
        self.assertEqual(events[-1], {"type": "done"})
        self.assertEqual(len(llm.calls), 1)  # stopped after the auth-required tool

    def test_direct_answer_no_tools_streams_tokens(self):
        llm = StreamingLLM([[text_ev("Hi "), text_ev("there"), final_ev([{"text": "Hi there"}], "end_turn")]])
        agent = _agent(llm, FakeConnectors({}))
        events = list(agent.answer_stream(SESSION, "hi"))
        self.assertEqual("".join(e["text"] for e in events if e["type"] == "token"), "Hi there")


if __name__ == "__main__":
    unittest.main()
