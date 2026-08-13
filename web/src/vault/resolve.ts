import type { TreeNode } from "./types";

// Flatten the folder tree into the list of note keys (files only).
export function flattenKeys(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.type === "file") out.push(n.path);
    else n.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

// Resolve a wikilink target to a key: exact path first, then a unique basename
// match (how Obsidian resolves bare note names). Mirrors the server resolver.
export function resolveWikilink(target: string, keys: string[]): string | null {
  const t = target.replace(/\.(md|markdown)$/i, "").toLowerCase();
  const base = t.split("/").pop();
  let baseMatch: string | null = null;
  for (const k of keys) {
    const kNoExt = k.replace(/\.(md|markdown)$/i, "").toLowerCase();
    if (kNoExt === t) return k;
    if (!baseMatch && kNoExt.split("/").pop() === base) baseMatch = k;
  }
  return baseMatch;
}

// Turn a user-entered note name or path into a safe .md key, dropping any leading
// slashes and "." / ".." path segments.
export function newNoteKey(name: string): string {
  let key = name
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
  if (!key) return "";
  if (!/\.(md|markdown)$/i.test(key)) key += ".md";
  return key;
}
