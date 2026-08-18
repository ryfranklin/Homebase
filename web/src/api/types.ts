// Event types streamed by the BFF over SSE.

export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; name?: string; [key: string]: unknown }
  | { type: "citation"; source_path: string; score?: number; [key: string]: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export interface Citation {
  sourcePath: string;
  score?: number;
}

export interface ChatRequest {
  input: string;
  sessionId?: string;
  // "plan" runs the agent's AI-DLC planning interview instead of a normal answer.
  mode?: "plan";
  // The settings-level default model id to invoke. Validated server-side against an
  // allow-list; omitting it uses the agent's deploy-time default model.
  model?: string;
  // Chat scope: "vault" restricts the agent to the knowledge base + connectors (no
  // general knowledge); "general" (or omitted) allows a labeled general fallback.
  scope?: "vault" | "general";
}
