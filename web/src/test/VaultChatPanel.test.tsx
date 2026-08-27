import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { VaultChatPanel } from "../components/VaultChatPanel";
import type { ChatMessage } from "../chat/messages";

function msg(role: "user" | "assistant", text: string): ChatMessage {
  return { id: role + text, role, text, citations: [], toolEvents: [], streaming: false };
}

describe("VaultChatPanel", () => {
  it("sends a plain message (no command) and clears the input", () => {
    const onSend = vi.fn();
    render(<VaultChatPanel messages={[]} streaming={false} onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "what did we decide?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("what did we decide?", {});
    expect(box).toHaveValue("");
  });

  it("routes a /vault slash command to the vault scope with the command stripped", () => {
    const onSend = vi.fn();
    render(<VaultChatPanel messages={[]} streaming={false} onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "/vault what did we decide?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("what did we decide?", { scope: "vault" });
  });

  it("routes /web to a forced web search", () => {
    const onSend = vi.fn();
    render(<VaultChatPanel messages={[]} streaming={false} onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "/web events in phoenix" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("events in phoenix", { scope: "general", forceWeb: true });
  });

  it("shows the command hint menu while typing a slash command", () => {
    render(<VaultChatPanel messages={[]} streaming={false} onSend={() => {}} />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "/" } });
    expect(screen.getByText("/web <question>")).toBeInTheDocument();
    expect(screen.getByText("/vault <question>")).toBeInTheDocument();
    // Narrows as you type.
    fireEvent.change(box, { target: { value: "/v" } });
    expect(screen.getByText("/vault <question>")).toBeInTheDocument();
    expect(screen.queryByText("/web <question>")).toBeNull();
  });

  it("renders the transcript", () => {
    render(
      <VaultChatPanel
        messages={[msg("user", "hi"), msg("assistant", "hello there")]}
        streaming={false}
        onSend={() => {}}
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
