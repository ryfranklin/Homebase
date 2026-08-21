import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useConnectorCallback } from "../connectors/useConnectorCallback";

vi.mock("../connectors/completeAuth", () => ({
  completeConnectorAuth: vi.fn(async () => {}),
}));
import { completeConnectorAuth } from "../connectors/completeAuth";

const getToken = async () => "tok";

describe("useConnectorCallback (popup relay)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finalizes a session id relayed from the consent popup, without a reload", async () => {
    renderHook(() => useConnectorCallback("https://api.test", getToken, true));
    // The popup posts the session id back to the opener (this window).
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "homebase:connector", sessionId: "sess-1" },
      }),
    );
    await waitFor(() =>
      expect(completeConnectorAuth).toHaveBeenCalledWith("https://api.test", "tok", "sess-1"),
    );
  });

  it("ignores relayed messages from a foreign origin", async () => {
    renderHook(() => useConnectorCallback("https://api.test", getToken, true));
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example",
        data: { type: "homebase:connector", sessionId: "sess-x" },
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(completeConnectorAuth).not.toHaveBeenCalled();
  });

  it("does nothing until authenticated", async () => {
    renderHook(() => useConnectorCallback("https://api.test", getToken, false));
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "homebase:connector", sessionId: "sess-2" },
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(completeConnectorAuth).not.toHaveBeenCalled();
  });
});
