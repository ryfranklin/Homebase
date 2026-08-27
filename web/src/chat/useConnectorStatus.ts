import { useCallback, useEffect, useRef, useState } from "react";

export interface ConnectorStatus {
  status: "connected" | "needs_auth" | "unknown";
  authorizationUrl?: string | null;
}
export type ConnectorStatuses = Record<string, ConnectorStatus>;

// Fetches /api/connectors/status (which shims report from the token vault) so the UI
// can show what is actually connected and offer a Connect link for the rest.
export function useConnectorStatus(
  apiBaseUrl: string,
  getToken: () => Promise<string>,
  enabled: boolean,
): { connectors: ConnectorStatuses; refresh: () => Promise<void> } {
  const [connectors, setConnectors] = useState<ConnectorStatuses>({});
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const refresh = useCallback(async () => {
    try {
      const token = await getTokenRef.current();
      const res = await fetch(`${apiBaseUrl}/api/connectors/status`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = await res.json();
      setConnectors(body.connectors ?? {});
    } catch {
      /* status is best-effort; leave the last known map */
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    // Light poll so a token that expires mid-session surfaces in the reconnect banner
    // without the user having to trigger a failing call first. Cheap (a status probe),
    // and paused when the tab is hidden to avoid needless traffic.
    const POLL_MS = 90_000;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  return { connectors, refresh };
}
