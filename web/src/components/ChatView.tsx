import { useEffect, useRef, useState } from "react";

import type { ChatMessage } from "../chat/messages";
import { Citations } from "./Citations";

export interface ChatViewProps {
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (input: string) => void;
  onStop?: () => void;
  onSignOut?: () => void;
}

// Presentational streaming chat. Mobile-first: a single column that fills the
// viewport, a scrollable transcript, and a composer pinned to the bottom (with
// safe-area padding for notched phones).
export function ChatView({ messages, streaming, onSend, onStop, onSignOut }: ChatViewProps) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

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
        <span className="chat-title">Homebase</span>
        {onSignOut && (
          <button type="button" className="link-button" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </header>

      <main className="transcript" aria-live="polite">
        {messages.length === 0 && (
          <p className="empty">Ask a question about your knowledge base.</p>
        )}
        {messages.map((m) => (
          <article key={m.id} className={`message ${m.role}`} data-testid={`message-${m.role}`}>
            <div className="bubble">
              {m.text || (m.streaming ? <span className="cursor">▋</span> : null)}
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
          placeholder="Message Homebase"
          rows={1}
          aria-label="Message"
        />
        {streaming && onStop ? (
          <button type="button" className="send-button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="send-button" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}
