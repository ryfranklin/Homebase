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
});
