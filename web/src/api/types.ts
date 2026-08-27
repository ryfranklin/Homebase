// Event types streamed by the BFF over SSE.

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name?: string; [key: string]: unknown }
  | { type: "citation"; source_path: string; score?: number; [key: string]: unknown }
  // A connector the agent tried to use needs the user to (re)link their account.
  // Surfaced non-blockingly so the user can reconnect in a separate window without
  // losing the current chat. `connector` is best-effort (may be absent).
  | { type: "authorization_required"; url: string; connector?: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface Citation {
  sourcePath: string;
  score?: number;
}

export interface ChatRequest {
  input: string;
  sessionId?: string;
  // "plan" runs the AI-DLC planning interview; "author" runs the document-authoring
  // interview (template -> guided fill -> homebase-note). Omitted is a normal answer.
  mode?: "plan" | "author";
  // The settings-level default model id to invoke. Validated server-side against an
  // allow-list; omitting it uses the agent's deploy-time default model.
  model?: string;
  // Chat scope: "vault" restricts the agent to the knowledge base + connectors (no
  // general knowledge); "general" (or omitted) allows a labeled general fallback.
  scope?: "vault" | "general";
  // Plan mode only: the current flight plan being revised, serialized as JSON. The
  // agent folds it into the turn so it edits the existing plan instead of drafting anew.
  planContext?: string;
  // Author mode only: the document being written (target path, topic, and the chosen
  // template on turn one or the current draft on later turns), serialized as JSON.
  authorContext?: string;
}
