import { lazy, Suspense, useEffect, useRef, useState } from "react";

import type { ChatMessage } from "../chat/messages";
import type { ModelOption } from "../config";
import type { ThreadSummary } from "../chat/threadsApi";
import type { ConnectorStatuses } from "../chat/useConnectorStatus";
import { Citations } from "./Citations";
import { ChatConnections } from "./ChatConnections";
import { noteFromMarkdown, stripNoteBlock } from "../vault/noteDraft";

const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

export type ChatScope = "vault" | "general";

export interface VaultChatPanelProps {
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (input: string) => void;
  onStop?: () => void;
  scope: ChatScope;
  onScopeChange: (scope: ChatScope) => void;
  models?: ModelOption[];
  model?: string;
  onModelChange?: (id: string) => void;
  // Thread memory (saved conversations in the vault).
  threads?: ThreadSummary[];
  activeId?: string;
  onSelectThread?: (id: string) => void;
  onNewThread?: () => void;
  onClose?: () => void;
  // What's connected, for the empty-state "Connected / Connect" strip.
  connectors?: ConnectorStatuses;
  onConnect?: (url: string) => void;
  // Create a vault note the agent drafted in a `homebase-note` block (path + content).
  onCreateNote?: (path: string, content: string) => void;
}

// Settings-level model picker, shown only when the deploy configured model choices.
function ModelSelector({ models, model, onModelChange }: { models: ModelOption[]; model?: string; onModelChange?: (id: string) => void }) {
  if (models.length === 0) return null;
  return (
    <select
      className="vault-chat-model"
      value={model ?? models[0].id}
      onChange={(e) => onModelChange?.(e.target.value)}
      aria-label="Chat model"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

function Thinking() {
  return (
    <div className="thinking" role="status" aria-label="Thinking">
      <span className="thinking-dots" aria-hidden="true">
        <i></i>
        <i></i>
        <i></i>
      </span>
      <span className="thinking-label">Thinking</span>
    </div>
  );
}

// A chat panel docked in the Vault surface. The scope toggle chooses whether the
// agent answers strictly from vault material (KB docs + connectors) or opens up to
// general knowledge. It reuses the same streaming chat engine as before.
export function VaultChatPanel({ messages, streaming, onSend, onStop, scope, onScopeChange, models = [], model, onModelChange, threads = [], activeId, onSelectThread, onNewThread, onClose, connectors, onConnect, onCreateNote }: VaultChatPanelProps) {
  const [input, setInput] = useState("");
  // Mobile only (CSS-gated <=860px): the chat is a bottom sheet that starts as a
  // collapsed launcher bar above the nav and expands on tap. Ignored on desktop.
  const [collapsed, setCollapsed] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void import("./Markdown");
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    onSend(input);
    setInput("");
  };

  return (
    <aside className={`vault-chat${collapsed ? " collapsed" : ""}`} aria-label="Chat">
      <button
        type="button"
        className="vault-chat-launcher"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="copilot-mark" aria-hidden="true">
          ✦
        </span>
        Chat
        <span className="vault-chat-launcher-chev" aria-hidden="true">{collapsed ? "▴" : "▾"}</span>
      </button>
      {(onNewThread || threads.length > 0) && (
        <div className="vault-chat-threads">
          {onNewThread && (
            <button type="button" className="link-button" onClick={onNewThread} title="Start a new chat">
              + New
            </button>
          )}
          {threads.length > 0 && (
            <select
              className="vault-chat-threadselect"
              value={threads.some((t) => t.id === activeId) ? (activeId ?? "") : ""}
              onChange={(e) => e.target.value && onSelectThread?.(e.target.value)}
              aria-label="Saved chats"
            >
              <option value="">Recent chats…</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="vault-chat-head">
        <div className="scope-toggle" role="tablist" aria-label="Chat scope">
          <button
            type="button"
            role="tab"
            aria-selected={scope === "vault"}
            className={scope === "vault" ? "scope-active" : undefined}
            onClick={() => onScopeChange("vault")}
            title="Answer only from your vault: knowledge base docs + connected accounts"
          >
            Vault only
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === "general"}
            className={scope === "general" ? "scope-active" : undefined}
            onClick={() => onScopeChange("general")}
            title="Open the model to general knowledge and features"
          >
            General
          </button>
        </div>
        <div className="vault-chat-head-right">
          <ModelSelector models={models} model={model} onModelChange={onModelChange} />
          {onClose && (
            <button type="button" className="link-button vault-chat-close" onClick={onClose} aria-label="Hide chat">
              ×
            </button>
          )}
        </div>
      </div>

      <main className="vault-chat-transcript" aria-live="polite">
        {messages.length === 0 && (
          <div className="vault-chat-empty">
            <p className="vault-chat-empty-title">
              {scope === "vault" ? "Ask about your vault." : "Ask anything."}
            </p>
            <p className="vault-chat-empty-sub">
              {scope === "vault"
                ? "Answers come only from your knowledge base and connected accounts, with citations."
                : "General knowledge is on; vault sources are still cited when used."}
            </p>
            {connectors && <ChatConnections connectors={connectors} onConnect={onConnect} />}
          </div>
        )}
        {messages.map((m) => {
          // A note the agent drafted (only once the block is complete, i.e. not
          // streaming). The block is stripped from the shown text and surfaced as a card.
          const note = m.role === "assistant" && !m.streaming ? noteFromMarkdown(m.text) : null;
          const shown = m.role === "assistant" ? stripNoteBlock(m.text) : m.text;
          return (
          <article key={m.id} className={`message ${m.role}`} data-testid={`message-${m.role}`}>
            <div className="bubble">
              {shown ? (
                m.role === "assistant" ? (
                  <Suspense fallback={<div className="prose">{shown}</div>}>
                    <Markdown text={shown} />
                  </Suspense>
                ) : (
                  <div className="prose">{shown}</div>
                )
              ) : m.streaming ? (
                <Thinking />
              ) : null}
              {m.error && <div className="message-error">{m.error}</div>}
            </div>
            {note && onCreateNote && (
              <div className="pd-draft note-draft">
                <div className="pd-draft-info">
                  <strong>Create note</strong>
                  <span>{note.path}</span>
                </div>
                <button type="button" className="vault-btn primary" onClick={() => onCreateNote(note.path, note.content)}>
                  Create note
                </button>
              </div>
            )}
            {m.toolEvents.length > 0 && (
              <div className="tool-events">
                {m.toolEvents.map((t, i) => (
                  <span key={i} className="tool-chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {m.role === "assistant" && <Citations citations={m.citations} />}
          </article>
          );
        })}
        <div ref={endRef} />
      </main>

      <form className="composer vault-chat-composer" onSubmit={submit}>
        <div className="composer-field">
          <textarea
            className="composer-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            placeholder={scope === "vault" ? "Ask your vault…" : "Message Homebase…"}
            rows={1}
            aria-label="Message"
          />
          {streaming && onStop ? (
            <button type="button" className="icon-button stop" onClick={onStop} aria-label="Stop">
              <span className="stop-glyph" aria-hidden="true"></span>
            </button>
          ) : (
            <button type="submit" className="icon-button send" disabled={!input.trim()} aria-label="Send">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M12 20V5M12 5l-6 6M12 5l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
