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
}
