import { useState } from "react";

import type { SourceOrigin, VaultDoc } from "../plan/corpus";

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
}: {
  catalog: VaultDoc[];
  selected: string[];
  onAdd: (ref: string) => void;
  onCreate: (title: string) => void;
  onUpload: (name: string) => void;
  onClose: () => void;
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

        {ORIGIN_GROUPS.map(({ origin, label }) => {
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
