import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { VaultView } from "../components/VaultView";
import type { UseVault } from "../vault/useVault";
import type { UseChat } from "../chat/useChat";
import type { Note, TreeNode } from "../vault/types";

// The Vault surface now docks a chat panel; these props are required by every render.
const chatProps = {
  chat: {
    messages: [],
    streaming: false,
    send: async () => {},
    stop: () => {},
    sessionId: "web-test",
    newThread: () => {},
    loadThread: () => {},
  } as UseChat,
  threads: {
    threads: [],
    activeId: "web-test",
    refresh: async () => {},
    selectThread: async () => {},
    newThread: () => {},
  },
};

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
    render(<VaultView {...chatProps} vault={fakeVault({ count: 3 })} onNavigate={() => {}} />);
    expect(screen.getByText("Your vault")).toBeInTheDocument();
    expect(screen.getByText(/3 notes/)).toBeInTheDocument();
  });

  it("opens a note from the tree", () => {
    const open = vi.fn();
    render(<VaultView {...chatProps} vault={fakeVault({ tree, open })} onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "adr-020" }));
    expect(open).toHaveBeenCalledWith("data-eng/adr-020.md");
  });

  it("renders an open note's title and markdown, and can enter edit mode", () => {
    const setEditing = vi.fn();
    render(<VaultView {...chatProps} vault={fakeVault({ note, setEditing })} onNavigate={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "ADR-020 Retrieval" })).toBeInTheDocument();
    expect(screen.getByText("S3 Vectors").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(setEditing).toHaveBeenCalledWith(true);
  });

  it("navigates to other workspaces from the header", () => {
    const onNavigate = vi.fn();
    render(<VaultView {...chatProps} vault={fakeVault()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("tab", { name: "Plan" }));
    expect(onNavigate).toHaveBeenCalledWith("plan");
    fireEvent.click(screen.getByRole("tab", { name: "Mission" }));
    expect(onNavigate).toHaveBeenCalledWith("mission");
  });

  it("shows attribution and opens history", () => {
    const loadHistory = vi.fn();
    render(<VaultView {...chatProps} vault={fakeVault({ note, loadHistory })} onNavigate={() => {}} />);
    expect(screen.getByText(/Edited by ryan@example.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(loadHistory).toHaveBeenCalled();
  });

  it("shows the connection strip in the docked chat and connects a needs-auth account", () => {
    const onConnect = vi.fn();
    render(
      <VaultView
        {...chatProps}
        vault={fakeVault()}
        onNavigate={() => {}}
        connectors={{
          slack: { status: "connected" },
          gmail: { status: "needs_auth", authorizationUrl: "https://consent.example/gmail" },
        }}
        onConnect={onConnect}
      />,
    );
    // The "Connected / Connect" strip renders in the chat empty state.
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Slack")).toBeInTheDocument();
    // Clicking a needs-auth chip starts that connector's consent flow.
    fireEvent.click(screen.getByText("Gmail"));
    expect(onConnect).toHaveBeenCalledWith("https://consent.example/gmail");
  });

  it("renders the history panel and restores a version", () => {
    const restore = vi.fn();
    const history = [
      { versionId: "v2", updatedBy: "bob@example.com", updatedAt: new Date().toISOString(), size: 10, isCurrent: true },
      { versionId: "v1", updatedBy: "alice@example.com", updatedAt: new Date().toISOString(), size: 8, isCurrent: false },
    ];
    render(<VaultView {...chatProps} vault={fakeVault({ note, history, restore })} onNavigate={() => {}} />);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    // Only the non-current version has a Restore button.
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(restore).toHaveBeenCalledWith("v1");
  });
});
