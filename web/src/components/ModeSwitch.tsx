// The workspace navigation shared by the Vault, Chat, and Plan views: one brain,
// three front doors. Kept in one place so the tabs stay consistent everywhere.

export type AppMode = "vault" | "chat" | "plan";

const MODES: { id: AppMode; label: string }[] = [
  { id: "vault", label: "Vault" },
  { id: "chat", label: "Chat" },
  { id: "plan", label: "Plan" },
];

export function ModeSwitch({ active, onNavigate }: { active: AppMode; onNavigate: (mode: AppMode) => void }) {
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
    </div>
  );
}
