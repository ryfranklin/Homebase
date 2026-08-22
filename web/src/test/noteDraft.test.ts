import { describe, expect, it } from "vitest";

import { noteFromMarkdown, stripNoteBlock, normalizeNoteKey } from "../vault/noteDraft";

const reply = [
  "Sure — here's a note capturing that decision.",
  "",
  "```homebase-note",
  JSON.stringify({ path: "data-engineering/s3-vectors-decision.md", content: "# S3 Vectors\n\nWe stayed on S3 Vectors (ADR-002).\n\n```py\nx=1\n```" }),
  "```",
].join("\n");

describe("note draft from chat", () => {
  it("extracts a complete note block (path + markdown content, incl. nested fences)", () => {
    const note = noteFromMarkdown(reply);
    expect(note).not.toBeNull();
    expect(note!.path).toBe("data-engineering/s3-vectors-decision.md");
    expect(note!.content).toContain("# S3 Vectors");
    expect(note!.content).toContain("```py"); // nested code fence survives via JSON
  });

  it("returns null mid-stream (no closing fence yet) and for a plain answer", () => {
    expect(noteFromMarkdown("```homebase-note\n{ \"path\": \"a.md\"")).toBeNull();
    expect(noteFromMarkdown("just a normal answer, nothing to save")).toBeNull();
  });

  it("strips the block from the displayed text", () => {
    const shown = stripNoteBlock(reply);
    expect(shown).toBe("Sure — here's a note capturing that decision.");
    expect(shown).not.toContain("homebase-note");
  });

  it("normalizes a proposed path to a .md vault key", () => {
    expect(normalizeNoteKey("/notes/idea")).toBe("notes/idea.md");
    expect(normalizeNoteKey("notes/idea.md")).toBe("notes/idea.md");
    expect(normalizeNoteKey("  ")).toBe("");
  });

  it("ignores a block missing a path or content", () => {
    expect(noteFromMarkdown('```homebase-note\n{"content":"x"}\n```')).toBeNull();
    expect(noteFromMarkdown('```homebase-note\n{"path":"a.md"}\n```')).toBeNull();
  });
});
