import { useMemo, useState } from "react";

import type { ConnectorStatuses } from "../chat/useConnectorStatus";

// A friendly label per connector key (falls back to the key itself).
const LABELS: Record<string, string> = {
  gmail: "Gmail",
  gcal: "Google Calendar",
  gdrive: "Google Drive",
  slack: "Slack",
  atlassian: "Jira",
  jira: "Jira",
  confluence: "Confluence",
};

function label(key: string): string {
  return LABELS[key] ?? key;
}

// A NON-BLOCKING, dismissible banner that appears when one or more connectors need
// re-authorization (an expired/again-required token). It never interrupts the current
// screen: clicking Reconnect opens the consent in a SEPARATE window (onReconnect ->
// openConnectorConsent). Renders nothing when nothing needs auth. Dismissed banners
// reappear if a *different* connector later needs auth (the dismissed set is keyed).
export function ConnectorReauthBanner({
  connectors,
  onReconnect,
}: {
  connectors: ConnectorStatuses;
  onReconnect: (url: string) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const needsAuth = useMemo(
    () =>
      Object.entries(connectors)
        .filter(([, s]) => s.status === "needs_auth" && s.authorizationUrl)
        .map(([key, s]) => ({ key, url: s.authorizationUrl as string })),
    [connectors],
  );

  const visible = needsAuth.filter((c) => !dismissed.has(c.key));
  if (visible.length === 0) return null;

  return (
    <div role="status" className="connector-banner connector-banner--needs_auth">
      <span>
        {visible.length === 1
          ? `${label(visible[0].key)} needs to be reconnected.`
          : `${visible.length} connectors need to be reconnected.`}
      </span>
      <span className="connector-reauth-actions">
        {visible.map((c) => (
          <button
            key={c.key}
            type="button"
            className="connector-reauth-btn"
            onClick={() => onReconnect(c.url)}
          >
            {`Reconnect ${label(c.key)}`}
          </button>
        ))}
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(new Set([...dismissed, ...visible.map((c) => c.key)]))}
      >
        {"×"}
      </button>
    </div>
  );
}
