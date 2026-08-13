// A full-screen documentation panel with two tabs:
//   Architecture — the self-contained architecture.html (copied to public/) in an iframe
//   Diagrams     — UML/ERD/data-flow/sequence Mermaid diagrams rendered from /diagrams.md
// Both docs are copied from their canonical repo sources at build time.

import { useEffect, useState } from "react";

import { DiagramsView } from "../docs/DiagramsView";

type Tab = "architecture" | "diagrams";

export function DocsOverlay({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("architecture");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="docs-overlay" role="dialog" aria-modal="true" aria-label="Documentation">
      <header className="docs-bar">
        <span className="wordmark">
          <span className="wordmark-dot" aria-hidden="true"></span>
          Docs
        </span>
        <nav className="docs-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "architecture"}
            className={tab === "architecture" ? "on" : ""}
            onClick={() => setTab("architecture")}
          >
            Architecture
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "diagrams"}
            className={tab === "diagrams" ? "on" : ""}
            onClick={() => setTab("diagrams")}
          >
            Diagrams
          </button>
        </nav>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="docs-body">
        {tab === "architecture" ? (
          <iframe className="docs-frame" src="/architecture.html" title="Homebase architecture" />
        ) : (
          <DiagramsView />
        )}
      </div>
    </div>
  );
}
