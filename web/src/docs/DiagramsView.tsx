import { useEffect, useRef, useState } from "react";

import { parseDiagrams, renderMermaid, type Diagram } from "./diagrams";

function DiagramCard({ diagram }: { diagram: Diagram }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    renderMermaid(diagram.code)
      .then((svg) => {
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [diagram]);

  return (
    <section className="diagram">
      <h3 className="diagram-title">{diagram.title}</h3>
      {diagram.description && <p className="diagram-desc">{diagram.description}</p>}
      {failed ? (
        <pre className="diagram-src">{diagram.code}</pre>
      ) : (
        <div className="diagram-svg" ref={ref} aria-label={diagram.title} />
      )}
    </section>
  );
}

export function DiagramsView() {
  const [diagrams, setDiagrams] = useState<Diagram[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetch("/diagrams.md")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((md) => {
        if (!cancelled) setDiagrams(parseDiagrams(md));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load diagrams.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="docs-status">{error}</p>;
  if (!diagrams) return <p className="docs-status">Loading diagrams…</p>;

  return (
    <div className="diagrams">
      <header className="diagrams-intro">
        <h1>Architecture &amp; diagrams</h1>
        <p>The canonical UML, ERD, data-flow, and sequence diagrams for Homebase, rendered from the vault&apos;s diagrams source.</p>
      </header>
      {diagrams.map((d) => (
        <DiagramCard key={d.id} diagram={d} />
      ))}
    </div>
  );
}
