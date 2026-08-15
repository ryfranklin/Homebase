import { useState } from "react";

import type { SourceOrigin, VaultDoc } from "../plan/corpus";
import type { ConfluencePage } from "../plan/confluence";

const ORIGIN_GROUPS: { origin: SourceOrigin; label: string }[] = [
  { origin: "vault", label: "Vault" },
  { origin: "confluence", label: "Confluence" },
  { origin: "upload", label: "Uploads" },
];

// Ingest + select sources into a plan: pick from the vault or Confluence, upload a
// file, or create a new doc. Selecting snapshots the doc so the plan owns it.
export function AddSourceModal({
  catalog,
  selected,
  onAdd,
  onCreate,
  onUpload,
  onClose,
  onConfluenceSearch,
  onAddConfluence,
}: {
  catalog: VaultDoc[];
  selected: string[];
  onAdd: (ref: string) => void;
  onCreate: (title: string) => void;
  onUpload: (name: string) => void;
  onClose: () => void;
  onConfluenceSearch?: (query: string) => Promise<ConfluencePage[]>;
  onAddConfluence?: (page: ConfluencePage) => void;
}) {
  const [title, setTitle] = useState("");
  const sel = new Set(selected);

  return (
    <div className="src-modal-overlay" role="dialog" aria-label="Add sources" onClick={onClose}>
      <div className="src-modal" onClick={(e) => e.stopPropagation()}>
        <div className="src-modal-head">
          <h3>Add sources</h3>
          <button type="button" className="link-button" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="src-modal-actions">
          <div className="src-create">
            <input
              className="vault-new-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New doc title…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) {
                  onCreate(title.trim());
                  setTitle("");
                }
              }}
              aria-label="New doc title"
            />
            <button type="button" className="vault-btn" disabled={!title.trim()} onClick={() => { onCreate(title.trim()); setTitle(""); }}>
              Create
            </button>
          </div>
          <label className="src-upload">
            Upload file
            <input
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f.name);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        {onConfluenceSearch && <ConfluenceSearch onSearch={onConfluenceSearch} onAdd={onAddConfluence} />}

        {ORIGIN_GROUPS.map(({ origin, label }) => {
          // Confluence pages are searched live below; skip the static group.
          if (origin === "confluence" && onConfluenceSearch) return null;
          const docs = catalog.filter((d) => d.origin === origin);
          if (docs.length === 0) return null;
          return (
            <div key={origin} className="src-modal-group">
              <h4>{label}</h4>
              {docs.map((d) => {
                const added = sel.has(d.slug);
                return (
                  <div key={d.slug} className="src-pick">
                    <div className="src-pick-info">
                      <span className={`src-kind kind-${d.kind}`}>{d.kind}</span>
                      <span className="src-pick-title">{d.title}</span>
                      <span className="src-pick-sub">{d.path || d.externalUrl}</span>
                    </div>
                    <button
                      type="button"
                      className={`vault-btn${added ? "" : " primary"}`}
                      disabled={added}
                      onClick={() => onAdd(d.slug)}
                    >
                      {added ? "Added" : "Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Live Confluence search: type a query, add a page as a plan source.
function ConfluenceSearch({ onSearch, onAdd }: { onSearch: (q: string) => Promise<ConfluencePage[]>; onAdd?: (p: ConfluencePage) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ConfluencePage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const run = async () => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await onSearch(q.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "search failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="src-modal-group">
      <h4>Confluence</h4>
      <div className="src-cf-search">
        <input
          className="vault-new-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void run()}
          placeholder="Search Confluence design pages…"
          aria-label="Search Confluence"
        />
        <button type="button" className="vault-btn" onClick={() => void run()} disabled={busy || !q.trim()}>
          {busy ? "…" : "Search"}
        </button>
      </div>
      {error && <p className="src-cf-error">{error}</p>}
      {results.map((p) => {
        const key = p.id ?? p.title ?? "";
        const done = added.has(key);
        return (
          <div key={key} className="src-pick">
            <div className="src-pick-info">
              <span className="src-kind kind-design">design</span>
              <span className="src-pick-title">{p.title ?? "(untitled)"}</span>
              {p.excerpt && <span className="src-pick-sub">{p.excerpt}</span>}
            </div>
            <button
              type="button"
              className={`vault-btn${done ? "" : " primary"}`}
              disabled={done || !onAdd}
              onClick={() => {
                onAdd?.(p);
                setAdded((s) => new Set(s).add(key));
              }}
            >
              {done ? "Added" : "Add"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
