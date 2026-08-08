import type { ConnectorStatus } from "./useConnectorCallback";

const MESSAGES: Record<Exclude<ConnectorStatus, "idle">, string> = {
  working: "Finishing connecting your account…",
  done: "Account connected. This connector is ready to use.",
  error: "Could not finish connecting the account. Please try again.",
};

// Small status banner shown while/after a connector consent is finalized. Renders
// nothing on the normal (idle) path.
export function ConnectorBanner({
  status,
  onDismiss,
}: {
  status: ConnectorStatus;
  onDismiss: () => void;
}) {
  if (status === "idle") return null;
  return (
    <div role="status" className={`connector-banner connector-banner--${status}`}>
      <span>{MESSAGES[status]}</span>
      {status !== "working" && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          {"×"}
        </button>
      )}
    </div>
  );
}
