import { lazy, Suspense, useEffect, useRef, useState } from "react";

import type { ChatMessage } from "../chat/messages";
import { Citations } from "./Citations";
import { ChatSources } from "./ChatSources";
import { DocsOverlay } from "./DocsOverlay";
import { ServiceNetwork } from "./ServiceNetwork";

// Markdown pulls in react-markdown + highlight.js. Lazy-load it into its own chunk
// so the initial bundle stays lean; it's preloaded on mount (below) so the chunk is
// ready by the time an answer streams, and a plain-text fallback covers the gap.
const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

export interface ChatViewProps {
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (input: string) => void;
  onStop?: () => void;
  onSignOut?: () => void;
  onOpenVault?: () => void;
}

// A small pulsing indicator shown while the agent is working but hasn't streamed
// any text yet ("waiting...").
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

// Presentational streaming chat. A single centered column: a minimal header, a
// scrollable transcript, and a composer pinned to the bottom (safe-area aware).
export function ChatView({ messages, streaming, onSend, onStop, onSignOut, onOpenVault }: ChatViewProps) {
  const [input, setInput] = useState("");
  const [showDocs, setShowDocs] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Warm the Markdown chunk in the background so the first answer renders instantly.
    void import("./Markdown");
  }, []);

  useEffect(() => {
    // Optional-chained: scrollIntoView is absent in some test environments.
    endRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    onSend(input);
    setInput("");
  };

  return (
    <div className="chat">
      <header className="chat-header">
        <span className="wordmark">
          <span className="wordmark-dot" aria-hidden="true"></span>
          Homebase
        </span>
        <div className="header-actions">
          {onOpenVault && (
            <div className="mode-switch" role="tablist" aria-label="Workspace">
              <button type="button" onClick={onOpenVault} aria-selected="false">
                Vault
              </button>
              <button type="button" className="mode-active" aria-selected="true">
                Chat
              </button>
            </div>
          )}
          <button type="button" className="link-button" onClick={() => setShowDocs(true)}>
            Docs
          </button>
          {onSignOut && (
            <button type="button" className="link-button" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {showDocs && <DocsOverlay onClose={() => setShowDocs(false)} />}

      <div className="chat-body">
        <div className="chat-col">
          <main className="transcript" aria-live="polite">
        {messages.length === 0 && (
          <div className="empty">
            <ServiceNetwork />
            <h1 className="empty-title">Ask a question about your knowledge base.</h1>
            <p className="empty-sub">Your notes, mail, calendar, Drive, Slack, Jira, and Confluence — one place.</p>
          </div>
        )}
        {messages.map((m) => (
          <article key={m.id} className={`message ${m.role}`} data-testid={`message-${m.role}`}>
            <div className="bubble">
              {m.text ? (
                m.role === "assistant" ? (
                  <Suspense fallback={<div className="prose">{m.text}</div>}>
                    <Markdown text={m.text} />
                  </Suspense>
                ) : (
                  <div className="prose">{m.text}</div>
                )
              ) : m.streaming ? (
                <Thinking />
              ) : null}
              {m.error && <div className="message-error">{m.error}</div>}
            </div>
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
        ))}
        <div ref={endRef} />
      </main>

      <form className="composer" onSubmit={submit}>
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
            placeholder="Message Homebase…"
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
        <p className="composer-hint">Homebase can read your connected accounts. Answers are grounded in your sources.</p>
          </form>
        </div>

        <ChatSources messages={messages} streaming={streaming} />
      </div>
    </div>
  );
}
