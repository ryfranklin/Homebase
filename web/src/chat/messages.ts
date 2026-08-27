import type { Citation, StreamEvent } from "../api/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: Citation[];
  toolEvents: string[];
  streaming: boolean;
  error?: string;
  // Set when a connector the agent used needs (re)authorization. Drives a
  // non-blocking "Reconnect" affordance; the turn is NOT failed by it.
  pendingAuth?: { connector?: string; authorizationUrl: string };
}

// Pure reducer: fold one stream event into an assistant message. Exported so the
// streaming logic is unit-testable without React.
export function applyEvent(message: ChatMessage, event: StreamEvent): ChatMessage {
  switch (event.type) {
    case "token":
      return { ...message, text: message.text + event.text };
    case "citation":
      return {
        ...message,
        citations: [...message.citations, { sourcePath: event.source_path, score: event.score }],
      };
    case "tool_call":
      return { ...message, toolEvents: [...message.toolEvents, event.name ?? "tool_call"] };
    case "authorization_required":
      // Record the reconnect need without interrupting the stream; the UI shows a
      // Reconnect affordance and the app-level status refresh surfaces it in the banner.
      return { ...message, pendingAuth: { connector: event.connector, authorizationUrl: event.url } };
    case "error":
      return { ...message, error: event.message, streaming: false };
    case "done":
      return { ...message, streaming: false };
    default:
      return message;
  }
}

export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    if (!seen.has(c.sourcePath)) {
      seen.add(c.sourcePath);
      out.push(c);
    }
  }
  return out;
}
