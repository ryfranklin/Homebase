import { useState } from "react";

import type { AppMode } from "./ModeSwitch";
import { ModeSwitch } from "./ModeSwitch";
import { DiagramsView } from "../docs/DiagramsView";

// The Docs surface: architecture / diagram pages rendered natively (Mermaid) inside
// the app as a first-class page — not an overlay and not a separate HTML file. Pages
// come from the canonical Markdown docs, copied into public/ at build (copy-docs.mjs).
const PAGES = [
  {
    id: "diagrams",
    label: "Diagrams",
    src: "/diagrams.md",
    title: "Architecture & diagrams",
    blurb: "The canonical UML, ERD, data-flow, and sequence diagrams for Homebase.",
  },
  {
    id: "rag",
    label: "RAG pipeline",
    src: "/rag-pipeline.md",
    title: "RAG pipeline",
    blurb: "Ingestion, indexing, and two-rung retrieval + rerank — plus the eval-driven decision behind ADR-002.",
  },
];

export function DocsView({
  onNavigate,
  onSignOut,
  onOpenSettings,
}: {
  onNavigate: (mode: AppMode) => void;
  onSignOut?: () => void;
  onOpenSettings?: () => void;
}) {
  const [pageId, setPageId] = useState(PAGES[0].id);
  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0];

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
      <nav className="docs-pages" role="tablist" aria-label="Documentation pages">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === pageId}
            className={p.id === pageId ? "on" : ""}
            onClick={() => setPageId(p.id)}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <div className="docs-body">
        <DiagramsView src={page.src} title={page.title} blurb={page.blurb} />
      </div>
    </div>
  );
}
