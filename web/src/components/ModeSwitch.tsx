// The workspace navigation shared by the surfaces: one brain, a few front doors.
// Chat is merged into Vault (a docked chat panel), so there is no separate Chat tab.
// Kept in one place so the tabs stay consistent everywhere.

import { lazy, Suspense, useState } from "react";

// The Docs overlay carries the mermaid renderer, so lazy-load it: mermaid stays out
// of the shell bundle and only loads when the user actually opens Docs.
const DocsOverlay = lazy(() => import("./DocsOverlay").then((m) => ({ default: m.DocsOverlay })));

export type AppMode = "vault" | "plan" | "mission" | "evals";

const MODES: { id: AppMode; label: string }[] = [
  { id: "vault", label: "Vault" },
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
  // Docs is a global overlay (Architecture + rendered diagrams), not a workspace mode,
  // so the nav owns its open state directly. Available from every surface's nav.
  const [docsOpen, setDocsOpen] = useState(false);

  return (
    <>
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
        {/* Opens the Docs overlay: the architecture view plus the ERD / UML / data-flow
            / sequence diagrams, rendered from docs/diagrams.md. */}
        <button
          type="button"
          className="mode-link"
          title="Docs: architecture and diagrams"
          onClick={() => setDocsOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
            <path d="M14 3v5h5M8 13h8M8 17h5" />
          </svg>
          Docs
        </button>
        {onOpenSettings && (
          <button type="button" className="mode-settings" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </div>
      {docsOpen && (
        <Suspense fallback={null}>
          <DocsOverlay onClose={() => setDocsOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
