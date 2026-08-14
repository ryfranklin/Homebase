import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChatSources } from "../components/ChatSources";
import { computeSourceStates, sourceForTool } from "../chat/sources";
import type { ChatMessage } from "../chat/messages";

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: "m", role: "assistant", text: "", citations: [], toolEvents: [], streaming: false, ...overrides };
}

describe("sourceForTool", () => {
  it("maps known tool names and falls back to keywords", () => {
    expect(sourceForTool("search_knowledge_base")).toBe("kb");
    expect(sourceForTool("slack_read_messages")).toBe("slack");
    expect(sourceForTool("confluence_search")).toBe("confluence");
    expect(sourceForTool("some_gmail_thing")).toBe("gmail");
    expect(sourceForTool("unrelated")).toBeNull();
  });
});

describe("computeSourceStates", () => {
  const messages = [
    msg({ role: "user" }),
    msg({ toolEvents: ["search_knowledge_base", "slack_read_messages"] }),
    msg({ toolEvents: ["gmail_search_messages"], streaming: true }),
  ];
  it("marks used sources with counts and the streaming source active", () => {
    const states = computeSourceStates(messages, true);
    const by = (id: string) => states.find((s) => s.id === id)!;
    expect(by("kb").used).toBe(true);
    expect(by("slack").used).toBe(true);
    expect(by("gmail").active).toBe(true); // in the streaming turn
    expect(by("kb").active).toBe(false);
    expect(by("jira").used).toBe(false); // never pulled
  });
  it("nothing is active when not streaming", () => {
    const states = computeSourceStates(messages, false);
    expect(states.some((s) => s.active)).toBe(false);
  });
});

describe("ChatSources", () => {
  it("renders the hub, all sources, the pulling indicator, and cited leaves", () => {
    const messages = [
      msg({
        toolEvents: ["search_knowledge_base"],
        streaming: true,
        citations: [{ sourcePath: "data-eng/adr-020.md", score: 0.9 }],
      }),
    ];
    render(<ChatSources messages={messages} streaming={true} />);
    expect(screen.getByText("Homebase")).toBeInTheDocument();
    expect(screen.getByText("Vault")).toBeInTheDocument();
    expect(screen.getByText("Confluence")).toBeInTheDocument();
    expect(screen.getByText("pulling")).toBeInTheDocument();
    // The Vault node is active and shows the cited doc as a leaf.
    expect(screen.getByText("Vault").closest("li")).toHaveClass("active");
    expect(screen.getByText("adr-020.md")).toBeInTheDocument();
  });
});
