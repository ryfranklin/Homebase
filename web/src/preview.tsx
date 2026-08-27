// Dev-only design preview. Renders UI with sample data so the design can be viewed
// on localhost without a real Cognito session. Gated behind import.meta.env.DEV in
// App, so it is never part of a production build.

import { FlightPlanner } from "./plan/FlightPlanner";
import { VaultChatPanel } from "./components/VaultChatPanel";
import { EvalsView } from "./components/EvalsView";
import { DocsView } from "./components/DocsView";
import { SAMPLE_PAYLOAD, SAMPLE_SUMMARY } from "./evals/api";
import type { UseEvals } from "./evals/useEvals";
import type { ChatMessage } from "./chat/messages";

const SAMPLE: ChatMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "What did we decide about S3 Vectors?",
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
      "See [ADR-002](https://example.invalid/adr-002-retrieval-store).",
    citations: [
      { sourcePath: "data-engineering/adr-002-retrieval-store.md", score: 0.98 },
      { sourcePath: "data-engineering/retrieval-eval.md", score: 0.91 },
    ],
    toolEvents: ["search_knowledge_base"],
    streaming: false,
  },
];

function ChatPreview() {
  return (
    <div className="vault">
      <div className="vault-body">
        <aside className="vault-sidebar" style={{ opacity: 0.4 }}>
          <div className="vault-side-top">
            <input className="vault-search" placeholder="Search notes…" readOnly />
          </div>
        </aside>
        <main className="vault-main" />
        <VaultChatPanel
          messages={SAMPLE}
          streaming={false}
          onSend={() => {}}
          onStop={() => {}}
        />
      </div>
    </div>
  );
}

export function DesignPreview() {
  const mode = new URLSearchParams(window.location.search).get("preview");
  // ?preview=plan renders the Flight Planner prototype (board + plan + clearance).
  if (mode === "plan") return <FlightPlanner />;
  // ?preview=docs renders the Docs surface (architecture + diagrams, full page).
  if (mode === "docs") return <DocsView onNavigate={() => {}} onSignOut={() => {}} />;
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
  // ?preview / ?preview=chat renders the merged Vault chat panel with sample data.
  return <ChatPreview />;
}
