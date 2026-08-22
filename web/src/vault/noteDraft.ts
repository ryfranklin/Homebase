// A note the chat agent proposes: emitted as a fenced `homebase-note` JSON block so
// arbitrary markdown content (including its own code fences) round-trips safely. The
// vault chat surfaces it as a "Create note" card; clicking it persists through the
// normal vault API (versioned + attributed). Mirrors the flight-plan draft block.

export interface NoteDraft {
  path: string;
  content: string;
}

const NOTE_BLOCK = /```homebase-note\s*\n([\s\S]*?)\n```/;

// Normalize an agent-proposed path into a vault key: strip leading slashes, collapse
// whitespace in the filename, and ensure a .md extension. Returns "" for empty input.
export function normalizeNoteKey(path: string): string {
  const trimmed = (path || "").trim().replace(/^\/+/, "");
  if (!trimmed) return "";
  return /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

// Extract + parse the agent's note draft from its (possibly streaming) reply text.
// Returns null until a complete, valid block with a path and string content appears.
export function noteFromMarkdown(text: string): NoteDraft | null {
  const m = NOTE_BLOCK.exec(text || "");
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]);
    const path = normalizeNoteKey(typeof o?.path === "string" ? o.path : "");
    if (path && typeof o?.content === "string") return { path, content: o.content };
  } catch {
    /* incomplete/corrupt block: treat as not-a-note (still streaming, etc.) */
  }
  return null;
}

// Reply text with the note block removed, for display (the block is surfaced as a
// "Create note" card instead of raw JSON in the conversation).
export function stripNoteBlock(text: string): string {
  return (text || "").replace(NOTE_BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();
}
