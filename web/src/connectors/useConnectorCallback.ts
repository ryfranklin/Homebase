import { useEffect, useState } from "react";

import { completeConnectorAuth } from "./completeAuth";

export type ConnectorStatus = "idle" | "working" | "done" | "error";

// When the browser lands back on the SPA after a connector consent, the URL carries
// ?session_id=<sessionUri>. This hook detects it once, finalizes the consent via the
// BFF, then strips the param so a refresh does not retry. It is inert on every normal
// page load (no session_id) and until the user is authenticated (the finalize needs a
// bearer token).
export function useConnectorCallback(
  apiBaseUrl: string,
  getAccessToken: () => Promise<string>,
  authenticated: boolean,
): { status: ConnectorStatus; dismiss: () => void } {
  const [status, setStatus] = useState<ConnectorStatus>("idle");

  useEffect(() => {
    if (!authenticated) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) return;

    let cancelled = false;
    setStatus("working");
    void (async () => {
      try {
        const token = await getAccessToken();
        await completeConnectorAuth(apiBaseUrl, token, sessionId);
        if (!cancelled) setStatus("done");
      } catch {
        if (!cancelled) setStatus("error");
      } finally {
        // Strip session_id regardless of outcome so a refresh doesn't re-run.
        params.delete("session_id");
        const qs = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      }
    })();

    return () => {
      cancelled = true;
    };
    // Run once when authentication becomes available; the URL is read imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  return { status, dismiss: () => setStatus("idle") };
}
