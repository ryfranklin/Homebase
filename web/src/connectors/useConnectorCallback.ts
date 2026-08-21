import { useCallback, useEffect, useState } from "react";

import { completeConnectorAuth } from "./completeAuth";

export type ConnectorStatus = "idle" | "working" | "done" | "error";

const RELAY_TYPE = "homebase:connector";

// Finalizes a connector consent (3LO) after the OAuth round-trip. Two return paths:
//
//   Popup (preferred): the consent opens in a separate window (see onConnect). It
//   returns to the SPA with ?session_id=; this hook detects it is the popup, relays
//   the session id to the opener via postMessage, and closes — the MAIN app never
//   reloads. The opener listens for that message and finalizes in place.
//
//   Full redirect (fallback, when the popup was blocked): the app itself navigated
//   away and lands back with ?session_id=; the hook finalizes on load and strips the
//   param so a refresh does not retry.
//
// Inert on every normal page load (no session_id) and until authenticated (finalize
// needs a bearer token).
export function useConnectorCallback(
  apiBaseUrl: string,
  getAccessToken: () => Promise<string>,
  authenticated: boolean,
): { status: ConnectorStatus; dismiss: () => void } {
  const [status, setStatus] = useState<ConnectorStatus>("idle");

  const finalize = useCallback(
    async (sessionId: string) => {
      setStatus("working");
      try {
        const token = await getAccessToken();
        await completeConnectorAuth(apiBaseUrl, token, sessionId);
        setStatus("done");
      } catch {
        setStatus("error");
      }
    },
    [apiBaseUrl, getAccessToken],
  );

  // Popup leg: if we are the consent popup returning with ?session_id=, hand it to the
  // opener and close. Runs before auth so the popup closes instantly (no app render).
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    const opener = window.opener as Window | null;
    if (sessionId && opener && opener !== window && !opener.closed) {
      try {
        opener.postMessage({ type: RELAY_TYPE, sessionId }, window.location.origin);
      } catch {
        /* opener gone / cross-origin: the redirect leg below still finalizes */
      }
      window.close();
    }
  }, []);

  // Opener leg: finalize a session id relayed from the popup, in place (no reload).
  useEffect(() => {
    if (!authenticated) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; sessionId?: string } | null;
      if (data?.type === RELAY_TYPE && data.sessionId) void finalize(data.sessionId);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [authenticated, finalize]);

  // Full-redirect fallback: the app itself returned with ?session_id= (popup blocked),
  // so finalize on load and strip the param. Skipped when we are a popup (handled above).
  useEffect(() => {
    if (!authenticated) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) return;
    if (window.opener && window.opener !== window) return; // popup leg owns this

    void finalize(sessionId);
    params.delete("session_id");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    // Run once when authentication becomes available; the URL is read imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  return { status, dismiss: () => setStatus("idle") };
}
