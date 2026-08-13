import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ChatView } from "../components/ChatView";
import type { ChatMessage } from "../chat/messages";

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "a1",
    role: "assistant",
    text: "Rotate the key every 90 days.",
    citations: [{ sourcePath: "ops/key-rotation.md", score: 0.9 }],
    toolEvents: [],
    streaming: false,
    ...overrides,
  };
}

describe("ChatView", () => {
  it("renders an assistant answer with its citation", () => {
    render(<ChatView messages={[assistant()]} streaming={false} onSend={() => {}} />);
    expect(screen.getByText(/Rotate the key/)).toBeInTheDocument();
    expect(screen.getByText("ops/key-rotation.md")).toBeInTheDocument();
    expect(screen.getByLabelText("Sources")).toBeInTheDocument();
  });

  it("submits the composer input", () => {
    const onSend = vi.fn();
    render(<ChatView messages={[]} streaming={false} onSend={onSend} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not submit while streaming and offers Stop", () => {
    const onStop = vi.fn();
    render(
      <ChatView
        messages={[assistant({ streaming: true })]}
        streaming={true}
        onSend={() => {}}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByLabelText("Stop"));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows an empty-state prompt with no messages", () => {
    render(<ChatView messages={[]} streaming={false} onSend={() => {}} />);
    expect(screen.getByText(/Ask a question/)).toBeInTheDocument();
  });
});
