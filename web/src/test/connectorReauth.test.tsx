import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { applyEvent, type ChatMessage } from "../chat/messages";
import { ConnectorReauthBanner } from "../connectors/ConnectorReauthBanner";

const baseMessage: ChatMessage = {
  id: "m1",
  role: "assistant",
  text: "",
  citations: [],
  toolEvents: [],
  streaming: true,
};

describe("applyEvent: authorization_required", () => {
  it("records pendingAuth without ending the stream", () => {
    const next = applyEvent(baseMessage, {
      type: "authorization_required",
      url: "https://consent.example/gmail",
      connector: "gmail",
    });
    expect(next.pendingAuth).toEqual({
      connector: "gmail",
      authorizationUrl: "https://consent.example/gmail",
    });
    // Non-blocking: the turn is not failed and streaming is untouched.
    expect(next.error).toBeUndefined();
    expect(next.streaming).toBe(true);
  });
});

describe("ConnectorReauthBanner", () => {
  it("renders nothing when no connector needs auth", () => {
    const { container } = render(
      <ConnectorReauthBanner connectors={{ slack: { status: "connected" } }} onReconnect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a Reconnect action that opens the consent in a separate window", () => {
    const onReconnect = vi.fn();
    render(
      <ConnectorReauthBanner
        connectors={{ gmail: { status: "needs_auth", authorizationUrl: "https://consent.example/gmail" } }}
        onReconnect={onReconnect}
      />,
    );
    fireEvent.click(screen.getByText("Reconnect Gmail"));
    expect(onReconnect).toHaveBeenCalledWith("https://consent.example/gmail");
  });

  it("can be dismissed", () => {
    const { container } = render(
      <ConnectorReauthBanner
        connectors={{ slack: { status: "needs_auth", authorizationUrl: "https://consent.example/slack" } }}
        onReconnect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(container.firstChild).toBeNull();
  });

  it("ignores needs_auth entries that have no authorization url yet", () => {
    const { container } = render(
      <ConnectorReauthBanner connectors={{ jira: { status: "needs_auth" } }} onReconnect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
