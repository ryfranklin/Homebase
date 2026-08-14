import type { ChatMessage } from "./messages";

// The sources the agent can pull from, in tree order under the Homebase hub.
export interface SourceDef {
  id: string;
  label: string;
}

export const SOURCES: SourceDef[] = [
  { id: "kb", label: "Vault" },
  { id: "slack", label: "Slack" },
  { id: "gmail", label: "Gmail" },
  { id: "gcal", label: "Calendar" },
  { id: "gdrive", label: "Drive" },
  { id: "jira", label: "Jira" },
  { id: "confluence", label: "Confluence" },
];

const TOOL_TO_SOURCE: Record<string, string> = {
  search_knowledge_base: "kb",
  slack_read_messages: "slack",
  gmail_search_messages: "gmail",
  gcal_list_events: "gcal",
  gdrive_search_files: "gdrive",
  jira_search_issues: "jira",
  confluence_search: "confluence",
};

// Map a tool-call name to a source id. Exact match first, then a keyword heuristic
// so tool-name variants still light up the right node.
export function sourceForTool(tool: string): string | null {
  if (TOOL_TO_SOURCE[tool]) return TOOL_TO_SOURCE[tool];
  const t = tool.toLowerCase();
  if (t.includes("knowledge") || t.includes("vault") || t.includes("retriev")) return "kb";
  if (t.includes("slack")) return "slack";
  if (t.includes("gmail") || t.includes("mail")) return "gmail";
  if (t.includes("cal")) return "gcal";
  if (t.includes("drive")) return "gdrive";
  if (t.includes("jira")) return "jira";
  if (t.includes("confluence")) return "confluence";
  return null;
}

export interface SourceState extends SourceDef {
  used: boolean; // pulled at some point in the conversation
  active: boolean; // being pulled right now (streaming)
  count: number; // how many tool calls hit this source
}

// Derive each source's state from the conversation. A source is "active" when the
// currently-streaming assistant turn has already called one of its tools.
export function computeSourceStates(messages: ChatMessage[], streaming: boolean): SourceState[] {
  const count = new Map<string, number>();
  for (const m of messages) {
    for (const tool of m.toolEvents) {
      const src = sourceForTool(tool);
      if (src) count.set(src, (count.get(src) ?? 0) + 1);
    }
  }

  const active = new Set<string>();
  if (streaming) {
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.streaming);
    for (const tool of last?.toolEvents ?? []) {
      const src = sourceForTool(tool);
      if (src) active.add(src);
    }
  }

  return SOURCES.map((s) => ({
    ...s,
    used: count.has(s.id),
    active: active.has(s.id),
    count: count.get(s.id) ?? 0,
  }));
}
