import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ChatConnections } from "../components/ChatConnections";

describe("ChatConnections", () => {
  it("renders nothing until status is known", () => {
    const { container } = render(<ChatConnections connectors={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows connected accounts and a Connect action that opens the consent url", () => {
    const onConnect = vi.fn();
    render(
      <ChatConnections
        connectors={{
          slack: { status: "connected" },
          gmail: { status: "needs_auth", authorizationUrl: "https://consent.example/gmail" },
        }}
        onConnect={onConnect}
      />,
    );
    // Connected chip present.
    expect(screen.getByText("Slack")).toBeInTheDocument();
    // Connect button fires onConnect with the vaulted authorization url.
    fireEvent.click(screen.getByText("Gmail"));
    expect(onConnect).toHaveBeenCalledWith("https://consent.example/gmail");
  });

  it("disables Connect when no authorization url is available", () => {
    render(<ChatConnections connectors={{ jira: { status: "needs_auth" } }} />);
    expect(screen.getByText("Jira").closest("button")).toBeDisabled();
  });
});
