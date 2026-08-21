import { useEffect, useMemo, useRef, useState } from "react";

import { streamChat } from "../api/sseClient";
import {
  planDraftFromMarkdown,
  planFromDraft,
  planSessionId,
  stripDraftBlock,
  type PlanDraft,
} from "../plan/persist";
import type { ChatMessage, Contributor, FlightPlan } from "../plan/types";

const AGENT_NAME = "planner·agent";

// The planning copilot: a persistent, grounded conversation that drafts a new flight plan
// or revises an existing one. It streams the Homebase agent in plan mode (which grounds on
// the vault and connectors), and when the agent emits a plan draft it surfaces a card to
// create or apply it. In revise mode the current plan is sent as context each turn (so the
// agent edits it, not starts over) and the transcript is persisted to the vault via
// onPersist, making the conversation team-visible and resumable.
//
// Two surfaces, one component: docked beside a plan (variant "dock") it is the side-by-side
// workspace; on the board (variant "modal") it drafts a brand-new plan.
export function PlanCopilot({
  apiBaseUrl,
  getToken,
  owner,
  plan,
  initialMessages,
  onPersist,
  onApplyDraft,
  onCreatePlan,
  variant = "dock",
  onClose,
}: {
  apiBaseUrl: string;
  getToken: () => Promise<string>;
  owner: Contributor;
  // Present => revise mode (edit this plan); absent => draft a new plan.
  plan?: FlightPlan;
  initialMessages?: ChatMessage[];
  // Persist the transcript (revise mode with a vault store). Called after each turn.
  onPersist?: (messages: ChatMessage[]) => void;
  // Revise: fold the agent's re-emitted draft back into the plan.
  onApplyDraft?: (draft: PlanDraft) => void;
  // New: create a flight plan from the agent's draft.
  onCreatePlan?: (plan: FlightPlan) => void;
  variant?: "dock" | "modal";
  onClose?: () => void;
}) {
  const revising = !!plan;
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // A stable session per plan keeps the agent's server-side memory continuous across a
  // team's turns; a fresh draft gets an ephemeral session until it becomes a plan. Both
  // clear AgentCore's 33-char session-id floor (planSessionId pads short slugs).
  const sessionId = useMemo(
    () => (plan ? planSessionId(plan) : `plan-draft-${crypto.randomUUID()}`),
    [plan],
  );

  // Re-seed when the open plan (and thus its loaded transcript) changes under us.
  useEffect(() => {
    setMessages(initialMessages ?? []);
    setDraft(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    setDraft(null);
    const at = new Date().toISOString();
    const base: ChatMessage[] = [
      ...messages,
      { role: "user", author: owner.name, text, at },
      { role: "agent", author: AGENT_NAME, text: "", at },
    ];
    setMessages(base);
    setStreaming(true);
    let acc = "";
    try {
      const token = await getToken();
      // In revise mode, hand the agent the current plan so it edits this plan.
      const planContext = plan ? JSON.stringify(plan) : undefined;
      for await (const evt of streamChat(apiBaseUrl, token, { input: text, sessionId, mode: "plan", planContext })) {
        if (evt.type === "token") {
          acc += evt.text;
          setMessages((m) => {
            const next = m.slice();
            next[next.length - 1] = { role: "agent", author: AGENT_NAME, text: acc, at };
            return next;
          });
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
      // Persist the settled transcript (revise mode): team-visible + resumable.
      const finalMessages: ChatMessage[] = [
        ...base.slice(0, -1),
        { role: "agent", author: AGENT_NAME, text: acc, at },
      ];
      setMessages(finalMessages);
      onPersist?.(finalMessages);
    }
  };

  const apply = () => {
    if (!draft) return;
    if (revising) onApplyDraft?.(draft);
    else onCreatePlan?.(planFromDraft(draft, owner, new Date().toISOString()));
    setDraft(null);
  };

  const hint = revising
    ? "Ask the copilot to refine this plan: tighten an objective, add acceptance criteria, reorder the route. It grounds on your vault and connectors, and re-drafts the plan for you to apply."
    : "Describe what you want to build or change. The copilot runs an AI-DLC interview, grounds on your vault and connectors, and drafts a plan with acceptance criteria and a units work-list.";

  const body = (
    <>
      <div className="copilot-head">
        <span className="copilot-mark" aria-hidden="true">
          ✈
        </span>
        {revising ? "Planning copilot" : "Draft a flight plan"}
        <span className="copilot-tag">vault-grounded</span>
        {variant === "modal" && onClose && (
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <div className="copilot-convo" aria-live="polite">
        {messages.length === 0 && <p className="pd-hint">{hint}</p>}
        {messages.map((m, i) => (
          <div key={i} className={`pd-msg ${m.role}`}>
            {m.role === "agent"
              ? stripDraftBlock(m.text) || (streaming && i === messages.length - 1 ? "…" : "")
              : m.text}
          </div>
        ))}
        {error && <div className="pd-error">{error}</div>}
        <div ref={endRef} />
      </div>

      {draft && (
        <div className="pd-draft">
          <div className="pd-draft-info">
            <strong>{draft.title || plan?.title || "Untitled plan"}</strong>
            <span>
              {(draft.criteria?.length ?? 0)} criteria · {(draft.route?.length ?? 0)} units
            </span>
          </div>
          <button type="button" className="vault-btn primary" onClick={apply}>
            {revising ? "Apply changes" : "Create plan"}
          </button>
        </div>
      )}

      <form
        className="copilot-composer"
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
          placeholder={streaming ? "Copilot is thinking…" : revising ? "Ask the copilot to refine the plan…" : "Describe the work, or answer the copilot…"}
          rows={2}
          aria-label="Message the planning copilot"
          disabled={streaming}
        />
        <button type="submit" className="vault-btn primary" disabled={streaming || !input.trim()}>
          Send
        </button>
      </form>
    </>
  );

  if (variant === "modal") {
    return (
      <div className="pd-overlay" role="dialog" aria-label="Draft a plan with the copilot" onClick={onClose}>
        <aside className="copilot copilot-modal" onClick={(e) => e.stopPropagation()}>
          {body}
        </aside>
      </div>
    );
  }
  return (
    <aside className="copilot copilot-live" aria-label="Planning copilot">
      {body}
    </aside>
  );
}
