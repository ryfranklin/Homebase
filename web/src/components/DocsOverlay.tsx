// A full-screen documentation panel that embeds the self-contained architecture
// doc (architecture.html, copied into public/ at build time) in an iframe. The doc
// carries its own dark styling and tabs, so we just frame it.

import { useEffect } from "react";

export function DocsOverlay({ onClose }: { onClose: () => void }) {
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
          Architecture
        </span>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </header>
      <iframe className="docs-frame" src="/architecture.html" title="Homebase architecture" />
    </div>
  );
}
