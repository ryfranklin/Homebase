import type { AppMode } from "./ModeSwitch";
import { ModeSwitch } from "./ModeSwitch";
import { DiagramsView } from "../docs/DiagramsView";

// The Docs surface: the architecture / ERD / UML / data-flow / sequence diagrams,
// rendered natively (Mermaid) inside the app as a first-class page — not an overlay
// and not a separate HTML file. Same shell (header + nav) as the other surfaces.
export function DocsView({
  onNavigate,
  onSignOut,
  onOpenSettings,
}: {
  onNavigate: (mode: AppMode) => void;
  onSignOut?: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="docs">
      <header className="chat-header">
        <span className="wordmark">
          <span className="wordmark-dot" aria-hidden="true"></span>
          Homebase
        </span>
        <div className="header-actions">
          <ModeSwitch active="docs" onNavigate={onNavigate} onOpenSettings={onOpenSettings} />
          {onSignOut && (
            <button type="button" className="link-button" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <div className="docs-body">
        <DiagramsView />
      </div>
    </div>
  );
}
