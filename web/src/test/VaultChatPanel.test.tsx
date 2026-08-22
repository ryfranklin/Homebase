import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { VaultChatPanel } from "../components/VaultChatPanel";
import type { ChatMessage } from "../chat/messages";

function msg(role: "user" | "assistant", text: string): ChatMessage {
  return { id: role + text, role, text, citations: [], toolEvents: [], streaming: false };
}

describe("VaultChatPanel", () => {
  it("renders the scope toggle with Vault active and switches to General", () => {
    const onScopeChange = vi.fn();
    render(
      <VaultChatPanel messages={[]} streaming={false} onSend={() => {}} scope="vault" onScopeChange={onScopeChange} />,
    );
    const vaultTab = screen.getByRole("tab", { name: "Vault only" });
    const generalTab = screen.getByRole("tab", { name: "General" });
    expect(vaultTab).toHaveAttribute("aria-selected", "true");
    expect(generalTab).toHaveAttribute("aria-selected", "false");
    fireEvent.click(generalTab);
    expect(onScopeChange).toHaveBeenCalledWith("general");
  });

  it("sends a message and clears the input", () => {
    const onSend = vi.fn();
    render(<VaultChatPanel messages={[]} streaming={false} onSend={onSend} scope="vault" onScopeChange={() => {}} />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "what did we decide?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("what did we decide?");
  });

  it("renders the transcript", () => {
    render(
      <VaultChatPanel
        messages={[msg("user", "hi"), msg("assistant", "hello there")]}
        streaming={false}
        onSend={() => {}}
        scope="general"
        onScopeChange={() => {}}
      />,
    );
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("hello there")).toBeInTheDocument();
  });

  it("surfaces a drafted note as a Create note card (not raw JSON) and creates it", () => {
    const onCreateNote = vi.fn();
    const block = ["Saved for you.", "", "```homebase-note", JSON.stringify({ path: "ideas/x.md", content: "# X\n\nbody" }), "```"].join("\n");
    render(
      <VaultChatPanel
        messages={[msg("assistant", block)]}
        streaming={false}
        onSend={() => {}}
        scope="vault"
        onScopeChange={() => {}}
        onCreateNote={onCreateNote}
      />,
    );
    // The prose shows; the raw block does not; the card offers the path.
    expect(screen.getByText("Saved for you.")).toBeInTheDocument();
    expect(screen.queryByText(/homebase-note/)).toBeNull();
    expect(screen.getByText("ideas/x.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create note" }));
    expect(onCreateNote).toHaveBeenCalledWith("ideas/x.md", "# X\n\nbody");
  });
});
