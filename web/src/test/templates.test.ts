import { describe, expect, it } from "vitest";

import { recommendTemplates, fillTemplate, slugify, deriveNoteKey, tokenize } from "../vault/templates";
import type { TemplateMeta } from "../vault/types";

const T = (name: string, extra: Partial<TemplateMeta> = {}): TemplateMeta => ({
  path: `templates/${name}.md`,
  name,
  label: name.replace(/[-_ ]*template$/i, "").replace(/[-_]+/g, " "),
  title: name,
  tags: [],
  type: null,
  ...extra,
});

const CATALOG: TemplateMeta[] = [
  T("adr-template", { tags: ["adr"] }),
  T("project design template"),
  T("wiki-entity-template", { type: "entity" }),
  T("one-on-one-template"),
  T("daily-standup-template"),
  T("food-template"),
];

describe("recommendTemplates", () => {
  it("ranks by name/tag/alias overlap with the intent", () => {
    const top = recommendTemplates("ADR for staying on S3 Vectors", "", CATALOG)[0];
    expect(top.template.name).toBe("adr-template");
    expect(top.score).toBeGreaterThan(0);
  });

  it("matches alias phrasings that differ from the file name", () => {
    const top = recommendTemplates("notes from my 1:1 with my manager", "", CATALOG)[0];
    expect(top.template.name).toBe("one-on-one-template");
  });

  it("boosts a template whose token appears in the target folder", () => {
    const top = recommendTemplates("staying on S3 Vectors", "ai/adr", CATALOG)[0];
    expect(top.template.name).toBe("adr-template");
  });

  it("returns every template (zero-score ones sorted last), so the full picker stays available", () => {
    const all = recommendTemplates("xyzzy nothing matches", "", CATALOG);
    expect(all).toHaveLength(CATALOG.length);
    expect(all.every((m) => m.score === 0)).toBe(true);
  });
});

describe("fillTemplate", () => {
  it("replaces {{title}}, {{date}}, {{time}} case- and whitespace-insensitively", () => {
    const out = fillTemplate('---\ntitle: "{{ title }}"\n---\n# {{title}}\n\n_last_: {{date}}: {{TIME}}', {
      title: "My Doc",
      date: "2026-08-22",
      time: "09:30",
    });
    expect(out).toContain('title: "My Doc"');
    expect(out).toContain("# My Doc");
    expect(out).toContain("2026-08-22: 09:30");
    expect(out).not.toContain("{{");
  });
});

describe("slugify / deriveNoteKey", () => {
  it("slugifies a title", () => {
    expect(slugify("ADR: Stay on S3 Vectors!")).toBe("adr-stay-on-s3-vectors");
  });

  it("derives folder/slug.md and strips traversal", () => {
    expect(deriveNoteKey("ai/adr", "Stay on S3 Vectors")).toBe("ai/adr/stay-on-s3-vectors.md");
    expect(deriveNoteKey("", "Loose Note")).toBe("loose-note.md");
    expect(deriveNoteKey("../etc", "x")).toBe("etc/x.md");
  });
});

describe("tokenize", () => {
  it("drops stopwords and short tokens", () => {
    expect(tokenize("Create a new note for the ADR")).toEqual(["adr"]);
  });
});
