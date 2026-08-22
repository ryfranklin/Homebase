// Pure helpers for the New-document flow: rank the vault's note templates against
// what the user is writing, fill a chosen template's placeholders, and derive the
// note key. No React, no fetch — unit-testable in isolation.

import type { TemplateMeta } from "./types";
import { normalizeNoteKey } from "./noteDraft";

// Words that carry no signal for matching a template to an intent.
const STOP = new Set([
  "a", "an", "the", "for", "to", "of", "and", "or", "on", "in", "new", "note", "doc",
  "document", "about", "my", "with", "create", "write", "draft", "make", "add", "up",
]);

export function tokenize(s: string): string[] {
  return (s || "").toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length > 1 && !STOP.has(t)) ?? [];
}

// Intent phrasings that should pull a specific template even when the words differ
// from its file name. Keyed by a stem found in the template's name/label; the
// keywords get folded into that template's match set.
const ALIASES: { stem: string; keywords: string[] }[] = [
  { stem: "adr", keywords: ["decision", "architecture", "tradeoff", "choose", "chose"] },
  { stem: "one-on-one", keywords: ["1", "one", "1on1", "oneonone", "manager", "report"] },
  { stem: "1 on 1", keywords: ["1", "one", "1on1", "oneonone"] },
  { stem: "standup", keywords: ["standup", "scrum", "blocker", "yesterday", "today"] },
  { stem: "retro", keywords: ["retro", "retrospective", "postmortem", "post"] },
  { stem: "journal", keywords: ["journal", "diary", "daily"] },
  { stem: "meeting", keywords: ["meeting", "minutes", "agenda", "attendees"] },
  { stem: "project design", keywords: ["project", "design", "spec", "proposal", "rfc"] },
  { stem: "wiki-entity", keywords: ["entity", "person", "company", "org", "who"] },
  { stem: "wiki-concept", keywords: ["concept", "idea", "definition", "glossary"] },
  { stem: "wiki-source", keywords: ["source", "reference", "citation", "paper", "article"] },
  { stem: "learning", keywords: ["learn", "learning", "study", "course", "tutorial"] },
  { stem: "sql-diagnostics", keywords: ["sql", "query", "diagnostic", "database", "explain"] },
  { stem: "aws-infra", keywords: ["aws", "infra", "infrastructure", "terraform", "cloud"] },
  { stem: "data-engineering", keywords: ["data", "pipeline", "etl", "ingest"] },
  { stem: "ai-experiment", keywords: ["experiment", "eval", "model", "prompt", "ai"] },
  { stem: "content-draft", keywords: ["content", "blog", "post", "article", "draft"] },
];

// The match set for a template: its label + name words + tags + type, plus any
// alias keywords whose stem the template name contains.
function templateTokens(t: TemplateMeta): Set<string> {
  const nameNoSuffix = t.name.replace(/[-_ ]*template$/i, "").replace(/[-_]+/g, " ");
  const tokens = new Set<string>([
    ...tokenize(t.label),
    ...tokenize(nameNoSuffix),
    ...t.tags.map((x) => x.toLowerCase()),
    ...(t.type ? [t.type.toLowerCase()] : []),
  ]);
  const hay = `${t.name} ${t.label}`.toLowerCase();
  for (const a of ALIASES) {
    if (hay.includes(a.stem)) for (const k of a.keywords) tokens.add(k);
  }
  return tokens;
}

export interface TemplateMatch {
  template: TemplateMeta;
  score: number;
}

// Rank templates against the intent text + target folder. A template scores for
// each of its tokens that appears in the intent, with extra weight when the token
// also matches a tag or shows up in the folder path. Ties break by label so the
// order is stable. Zero-score templates are still returned (sorted last) so the
// full picker list stays available.
export function recommendTemplates(intent: string, folder: string, templates: TemplateMeta[]): TemplateMatch[] {
  const intentTokens = new Set(tokenize(intent));
  const folderText = (folder || "").toLowerCase();
  const folderTokens = new Set(tokenize(folder));
  const matches = templates.map((template) => {
    const tokens = templateTokens(template);
    let score = 0;
    for (const tok of tokens) {
      if (intentTokens.has(tok)) score += 2;
      if (folderTokens.has(tok)) score += 3;
      // Substring hit (e.g. intent "adr-002" contains "adr") is a weaker signal.
      else if (folderText.includes(tok)) score += 2;
    }
    for (const tag of template.tags) {
      if (intentTokens.has(tag.toLowerCase())) score += 2;
    }
    return { template, score };
  });
  matches.sort((a, b) => b.score - a.score || a.template.label.localeCompare(b.template.label));
  return matches;
}

// Replace the template placeholders. Templates use {{title}}, {{date}}, {{time}}
// (whitespace-tolerant, case-insensitive).
export function fillTemplate(content: string, vars: { title: string; date: string; time: string }): string {
  return (content || "")
    .replace(/\{\{\s*title\s*\}\}/gi, vars.title)
    .replace(/\{\{\s*date\s*\}\}/gi, vars.date)
    .replace(/\{\{\s*time\s*\}\}/gi, vars.time);
}

export function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// folder + slug(title) + .md, with traversal/leading-slash stripped. Falls back to
// "untitled" when the title has no slug-able characters.
export function deriveNoteKey(folder: string, title: string): string {
  const slug = slugify(title) || "untitled";
  const dir = (folder || "").trim().replace(/^\/+|\/+$/g, "").replace(/\.\.+/g, "");
  return normalizeNoteKey(dir ? `${dir}/${slug}` : slug);
}
