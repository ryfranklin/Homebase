import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { VaultView } from "../components/VaultView";
import type { UseVault } from "../vault/useVault";
import type { Note, TreeNode } from "../vault/types";

function fakeVault(overrides: Partial<UseVault> = {}): UseVault {
  return {
    tree: [],
    count: 0,
    keys: [],
    note: null,
    draft: "",
    editing: false,
    dirty: false,
    backlinks: [],
    status: { kind: "idle" },
    results: null,
    history: null,
    setDraft: () => {},
    setEditing: () => {},
    open: async () => {},
    openWikilink: () => {},
    save: async () => {},
    create: async () => {},
    remove: async () => {},
    search: async () => {},
    clearSearch: () => {},
    loadHistory: async () => {},
    restore: async () => {},
    clearHistory: () => {},
    refreshTree: async () => {},
    ...overrides,
  };
}

const note: Note = {
  key: "data-eng/adr-020.md",
  title: "ADR-020 Retrieval",
  content: "## Decision\n\nWe chose **S3 Vectors**.",
  frontMatter: {},
  links: [],
  updatedBy: "ryan@example.com",
  updatedById: "u-ryan",
  updatedAt: new Date().toISOString(),
};

const tree: TreeNode[] = [{ name: "adr-020.md", path: "data-eng/adr-020.md", type: "file" }];

describe("VaultView", () => {
  it("shows the empty state when no note is open", () => {
    render(<VaultView vault={fakeVault({ count: 3 })} onOpenChat={() => {}} />);
    expect(screen.getByText("Your vault")).toBeInTheDocument();
    expect(screen.getByText(/3 notes/)).toBeInTheDocument();
  });

  it("opens a note from the tree", () => {
    const open = vi.fn();
    render(<VaultView vault={fakeVault({ tree, open })} onOpenChat={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "adr-020" }));
    expect(open).toHaveBeenCalledWith("data-eng/adr-020.md");
  });

  it("renders an open note's title and markdown, and can enter edit mode", () => {
    const setEditing = vi.fn();
    render(<VaultView vault={fakeVault({ note, setEditing })} onOpenChat={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "ADR-020 Retrieval" })).toBeInTheDocument();
    expect(screen.getByText("S3 Vectors").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(setEditing).toHaveBeenCalledWith(true);
  });

  it("switches to chat from the header", () => {
    const onOpenChat = vi.fn();
    render(<VaultView vault={fakeVault()} onOpenChat={onOpenChat} />);
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(onOpenChat).toHaveBeenCalled();
  });

  it("shows attribution and opens history", () => {
    const loadHistory = vi.fn();
    render(<VaultView vault={fakeVault({ note, loadHistory })} onOpenChat={() => {}} />);
    expect(screen.getByText(/Edited by ryan@example.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(loadHistory).toHaveBeenCalled();
  });

  it("renders the history panel and restores a version", () => {
    const restore = vi.fn();
    const history = [
      { versionId: "v2", updatedBy: "bob@example.com", updatedAt: new Date().toISOString(), size: 10, isCurrent: true },
      { versionId: "v1", updatedBy: "alice@example.com", updatedAt: new Date().toISOString(), size: 8, isCurrent: false },
    ];
    render(<VaultView vault={fakeVault({ note, history, restore })} onOpenChat={() => {}} />);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    // Only the non-current version has a Restore button.
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(restore).toHaveBeenCalledWith("v1");
  });
});
