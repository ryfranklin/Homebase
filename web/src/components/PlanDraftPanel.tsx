import { useMemo, useRef, useState } from "react";

import { streamChat } from "../api/sseClient";
import { planDraftFromMarkdown, planFromDraft, stripDraftBlock, type PlanDraft } from "../plan/persist";
import type { Contributor, FlightPlan } from "../plan/types";

interface Msg {
  role: "user" | "agent";
  text: string;
}

// The AI-DLC planning interview: a conversation with the Homebase agent in plan mode.
// The agent interviews, grounds on the vault/connectors, and emits a plan draft; when
// a draft appears we surface a "Create plan" card that persists it as a flight plan.
export function PlanDraftPanel({
  apiBaseUrl,
  getToken,
  owner,
  onCreate,
  onClose,
}: {
  apiBaseUrl: string;
  getToken: () => Promise<string>;
  owner?: Contributor;
  onCreate: (plan: FlightPlan) => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useMemo(() => `plan-${crypto.randomUUID()}`, []);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", text }, { role: "agent", text: "" }]);
    setStreaming(true);
    let acc = "";
    try {
      const token = await getToken();
      for await (const evt of streamChat(apiBaseUrl, token, { input: text, sessionId, mode: "plan" })) {
        if (evt.type === "token") {
          acc += evt.text;
          setMessages((m) => {
            const next = m.slice();
            next[next.length - 1] = { role: "agent", text: acc };
            return next;
          });
          endRef.current?.scrollIntoView?.({ behavior: "smooth" });
        } else if (evt.type === "error") {
          setError(evt.message || "agent error");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "planning failed");
    } finally {
      setStreaming(false);
      const found = planDraftFromMarkdown(acc);
      if (found) setDraft(found);
    }
  };

  const create = () => {
    if (!draft) return;
    const owner_ = owner ?? { id: "you", name: "You", kind: "human" as const };
    onCreate(planFromDraft(draft, owner_, new Date().toISOString()));
  };

  return (
    <div className="pd-overlay" role="dialog" aria-label="Draft a plan with the agent" onClick={onClose}>
      <div className="pd" onClick={(e) => e.stopPropagation()}>
        <div className="pd-head">
          <h3>Draft a flight plan with the agent</h3>
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="pd-convo">
          {messages.length === 0 && (
            <p className="pd-hint">
              Describe what you want to build or change. The agent runs an AI-DLC interview, grounds on your vault and
              connectors, and drafts a plan with acceptance criteria and a units work-list.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`pd-msg ${m.role}`}>
              {m.role === "agent" ? stripDraftBlock(m.text) || (streaming && i === messages.length - 1 ? "…" : "") : m.text}
            </div>
          ))}
          {error && <div className="pd-error">{error}</div>}
          <div ref={endRef} />
        </div>

        {draft && (
          <div className="pd-draft">
            <div className="pd-draft-info">
              <strong>{draft.title || "Untitled plan"}</strong>
              <span>
                {(draft.criteria?.length ?? 0)} criteria · {(draft.route?.length ?? 0)} units
              </span>
            </div>
            <button type="button" className="vault-btn primary" onClick={create}>
              Create plan
            </button>
          </div>
        )}

        <form
          className="pd-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            className="pd-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={streaming ? "Agent is thinking…" : "Describe the work, or answer the agent…"}
            rows={2}
            aria-label="Message the planning agent"
            disabled={streaming}
          />
          <button type="submit" className="vault-btn primary" disabled={streaming || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
