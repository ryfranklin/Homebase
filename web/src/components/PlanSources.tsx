import type { PlanSource } from "../plan/corpus";

// The corpus knowledge a plan is grounded on: supporting ADRs / notes / decisions,
// each showing which acceptance criteria cite it and a relevance score (a stand-in
// for the KB rerank behind get_context).
export function PlanSources({
  sources,
  highlighted,
  onOpen,
}: {
  sources: PlanSource[];
  highlighted: string | null;
  onOpen: (slug: string) => void;
}) {
  if (sources.length === 0) {
    return <p className="fp-prose fp-muted">No vault sources referenced yet.</p>;
  }
  return (
    <div className="src-list">
      {sources.map(({ doc, citedBy, inContext, score }) => (
        <article
          key={doc.slug}
          id={`src-${doc.slug}`}
          className={`src-card${highlighted === doc.slug ? " highlight" : ""}`}
        >
          <header className="src-head">
            <span className={`src-kind kind-${doc.kind}`}>{doc.kind}</span>
            <span className="src-title">{doc.title}</span>
            <span className="src-score" title="grounding relevance">
              {score.toFixed(2)}
            </span>
          </header>
          <span className="src-path">{doc.path}</span>
          <p className="src-excerpt">{doc.excerpt}</p>
          <footer className="src-foot">
            <span className="src-cited">
              {inContext && <span className="src-tag">context</span>}
              {citedBy.length > 0 && <span className="src-tag">{citedBy.join(", ")}</span>}
            </span>
            <button type="button" className="src-open" onClick={() => onOpen(doc.slug)}>
              Open in Vault ↗
            </button>
          </footer>
        </article>
      ))}
    </div>
  );
}
