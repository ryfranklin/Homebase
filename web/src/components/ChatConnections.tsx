import { SOURCES } from "../chat/sources";
import type { ConnectorStatuses } from "../chat/useConnectorStatus";

// A compact "what's connected" strip for the chat empty state: connected accounts as
// chips, and a Connect chip (opens the consent flow) for those that need linking.
export function ChatConnections({
  connectors,
  onConnect,
}: {
  connectors: ConnectorStatuses;
  onConnect?: (url: string) => void;
}) {
  const sources = SOURCES.filter((s) => s.id !== "kb"); // Vault has no external connector
  const connected = sources.filter((s) => connectors[s.id]?.status === "connected");
  const needsAuth = sources.filter((s) => connectors[s.id]?.status === "needs_auth");
  if (connected.length === 0 && needsAuth.length === 0) return null; // status not loaded

  return (
    <div className="chat-connections">
      {connected.length > 0 && (
        <div className="cc-row">
          <span className="cc-label">Connected</span>
          {connected.map((s) => (
            <span key={s.id} className="cc-chip connected">
              <span className="cc-dot" aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {needsAuth.length > 0 && (
        <div className="cc-row">
          <span className="cc-label">Connect</span>
          {needsAuth.map((s) => {
            const url = connectors[s.id]?.authorizationUrl ?? null;
            return (
              <button
                key={s.id}
                type="button"
                className="cc-chip needs-auth"
                disabled={!url}
                onClick={() => url && onConnect?.(url)}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
