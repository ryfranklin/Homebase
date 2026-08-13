import { describe, expect, it } from "vitest";

import { flattenKeys, newNoteKey, resolveWikilink } from "../vault/resolve";
import type { TreeNode } from "../vault/types";

const tree: TreeNode[] = [
  {
    name: "data-eng",
    path: "data-eng",
    type: "dir",
    children: [{ name: "adr-002.md", path: "data-eng/adr-002.md", type: "file" }],
  },
  { name: "top.md", path: "top.md", type: "file" },
];

describe("vault resolve", () => {
  it("flattenKeys returns file paths only", () => {
    expect(flattenKeys(tree).sort()).toEqual(["data-eng/adr-002.md", "top.md"]);
  });

  it("resolveWikilink matches exact path then unique basename", () => {
    const keys = flattenKeys(tree);
    expect(resolveWikilink("adr-002", keys)).toBe("data-eng/adr-002.md");
    expect(resolveWikilink("data-eng/adr-002", keys)).toBe("data-eng/adr-002.md");
    expect(resolveWikilink("nope", keys)).toBeNull();
  });

  it("newNoteKey appends .md and strips traversal", () => {
    expect(newNoteKey("ideas/spark")).toBe("ideas/spark.md");
    expect(newNoteKey("already.md")).toBe("already.md");
    expect(newNoteKey("../evil")).toBe("evil.md");
    expect(newNoteKey("   ")).toBe("");
  });
});
