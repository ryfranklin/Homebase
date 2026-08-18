// Dev-only design preview. Renders the chat UI with sample data so the redesign
// (empty-state node graph, streaming/thinking states, citations) can be viewed on
// localhost without a real Cognito session. Gated behind import.meta.env.DEV in
// App, so it is never part of a production build.

import { ChatView } from "./components/ChatView";
import { FlightPlanner } from "./plan/FlightPlanner";
import { EvalsView } from "./components/EvalsView";
import { SAMPLE_PAYLOAD, SAMPLE_SUMMARY } from "./evals/api";
import type { UseEvals } from "./evals/useEvals";
import type { ChatMessage } from "./chat/messages";

const SAMPLE: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "What did we decide about S3 Vectors, and what's new in #general?",
    citations: [],
    toolEvents: [],
    streaming: false,
  },
  {
    id: "a1",
    role: "assistant",
    text:
      "### Retrieval decision\n\n" +
      "**ADR-002** kept Homebase on **S3 Vectors** (semantic + rerank):\n\n" +
      "- live eval `hit_rate@5 = 1.0` — above the `0.85` threshold\n" +
      "- the OpenSearch fallback was **not** triggered\n\n" +
      "See [ADR-002](https://example.invalid/adr-002-retrieval-store).\n\n" +
      "The retrieval call looks like:\n\n" +
      "```python\n" +
      "results = kb.retrieve(\n" +
      '    query="key rotation",   # semantic\n' +
      "    top_k=5,\n" +
      "    rerank=True,            # Bedrock Rerank\n" +
      ")\n" +
      "```\n\n" +
      "In **#general**, the latest thread is the Olympic curling rules question and a couple of recipe asks — nothing action-worthy.",
    citations: [
      { sourcePath: "data-engineering/adr-002-retrieval-store.md", score: 0.98 },
      { sourcePath: "data-engineering/retrieval-eval.md", score: 0.91 },
    ],
    toolEvents: ["search_knowledge_base", "slack_read_messages"],
    streaming: false,
  },
  {
    id: "a2",
    role: "assistant",
    text: "",
    citations: [],
    toolEvents: ["gcal_list_events"],
    streaming: true,
  },
];

export function DesignPreview() {
  const mode = new URLSearchParams(window.location.search).get("preview");
  // ?preview=plan renders the Flight Planner prototype (board + plan + clearance).
  if (mode === "plan") return <FlightPlanner />;
  // ?preview=evals renders the Evals diagnostics tab on the bundled sample run.
  if (mode === "evals") {
    const sampleEvals: UseEvals = {
      runs: [SAMPLE_SUMMARY],
      selected: SAMPLE_PAYLOAD,
      selectedId: SAMPLE_SUMMARY.runId,
      error: null,
      sample: true,
      refresh: async () => {},
      select: async () => {},
    };
    return <EvalsView evals={sampleEvals} onNavigate={() => {}} onSignOut={() => {}} />;
  }
  const messages = mode === "chat" ? SAMPLE : [];
  return (
    <ChatView
      messages={messages}
      streaming={mode === "chat"}
      onSend={() => {}}
      onStop={() => {}}
      onSignOut={() => {}}
    />
  );
}
