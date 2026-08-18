// The workspace navigation shared by the Vault, Chat, and Plan views: one brain,
// three front doors. Kept in one place so the tabs stay consistent everywhere.

export type AppMode = "vault" | "chat" | "plan" | "mission" | "evals";

const MODES: { id: AppMode; label: string }[] = [
  { id: "vault", label: "Vault" },
  { id: "chat", label: "Chat" },
  { id: "plan", label: "Plan" },
  { id: "mission", label: "Mission" },
  { id: "evals", label: "Evals" },
];

export function ModeSwitch({
  active,
  onNavigate,
  onOpenSettings,
}: {
  active: AppMode;
  onNavigate: (mode: AppMode) => void;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="mode-switch" role="tablist" aria-label="Workspace">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          className={m.id === active ? "mode-active" : undefined}
          aria-selected={m.id === active}
          onClick={() => m.id !== active && onNavigate(m.id)}
        >
          {m.label}
        </button>
      ))}
      {onOpenSettings && (
        <button type="button" className="mode-settings" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      )}
    </div>
  );
}
