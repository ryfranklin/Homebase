import { useEffect, useMemo, useState } from "react";

import type { TemplateMeta } from "../vault/types";
import { recommendTemplates, fillTemplate, deriveNoteKey } from "../vault/templates";

export interface NewDocPanelProps {
  listTemplates: () => Promise<TemplateMeta[]>;
  readTemplate: (path: string) => Promise<string>;
  existingKeys: string[];
  // Create a note (seeded content) or, with content omitted, a blank note in edit mode.
  onCreate: (key: string, content?: string) => void;
  // Present only once the agent authoring mode exists (Phase 2). When set, a
  // "Draft with AI" button launches a guided session seeded with the template + intent.
  onDraftWithAI?: (args: { intent: string; folder: string; template: TemplateMeta | null }) => void;
  onClose: () => void;
}

// The New-document panel: describe the doc, get a recommended template, then seed it
// instantly ("Use template"), start a blank note, or hand off to the AI author.
export function NewDocPanel({ listTemplates, readTemplate, existingKeys, onCreate, onDraftWithAI, onClose }: NewDocPanelProps) {
  const [intent, setIntent] = useState("");
  const [folder, setFolder] = useState("");
  const [templates, setTemplates] = useState<TemplateMeta[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // explicit user choice; null = follow recommendation
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listTemplates()
      .then((t) => live && setTemplates(t))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [listTemplates]);

  // Recommendation order recomputed as the user types; the top nonzero match is the
  // default template unless the user explicitly picked one.
  const ranked = useMemo(
    () => (templates ? recommendTemplates(intent, folder, templates) : []),
    [templates, intent, folder],
  );
  const recommended = ranked.find((m) => m.score > 0)?.template ?? null;
  const selectedPath = picked ?? recommended?.path ?? "";
  const selected = templates?.find((t) => t.path === selectedPath) ?? null;

  const derivedKey = deriveNoteKey(folder, intent || "untitled");

  const guardOverwrite = (key: string) =>
    !existingKeys.includes(key) || window.confirm(`"${key}" already exists. Overwrite it?`);

  const useTemplate = async () => {
    if (!intent.trim()) {
      setError("Say what the document is about first.");
      return;
    }
    if (!guardOverwrite(derivedKey)) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const vars = { title: intent.trim(), date: now.toISOString().slice(0, 10), time: now.toTimeString().slice(0, 5) };
      // With a template, seed the filled skeleton; without one, fall through to a blank
      // note (undefined content) so the editor opens ready to type.
      const body = selected ? fillTemplate(await readTemplate(selected.path), vars) : undefined;
      onCreate(derivedKey, body);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const blankNote = () => {
    if (!intent.trim()) {
      setError("Give the note a name first.");
      return;
    }
    if (!guardOverwrite(derivedKey)) return;
    onCreate(derivedKey); // undefined content -> blank note, edit mode
    onClose();
  };

  return (
    <div className="newdoc" role="group" aria-label="New document">
      <label className="newdoc-field">
        <span className="newdoc-label">What's it about?</span>
        <input
          autoFocus
          className="newdoc-input"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void useTemplate();
            if (e.key === "Escape") onClose();
          }}
          placeholder="e.g. ADR for staying on S3 Vectors"
        />
      </label>

      <label className="newdoc-field">
        <span className="newdoc-label">Folder (optional)</span>
        <input
          className="newdoc-input"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="ai/adr"
        />
      </label>

      {templates && (
        <div className="newdoc-template">
          <div className="newdoc-rec">
            <span className="newdoc-label">Template</span>
            {recommended && !picked && <span className="newdoc-star" title="Recommended">★ recommended</span>}
          </div>
          <select
            className="newdoc-select"
            value={selectedPath}
            onChange={(e) => setPicked(e.target.value)}
            aria-label="Template"
          >
            <option value="">Blank (no template)</option>
            {(showAll ? templates.slice().sort((a, b) => a.label.localeCompare(b.label)) : ranked.map((m) => m.template)).map(
              (t) => (
                <option key={t.path} value={t.path}>
                  {t.label}
                  {t.path === recommended?.path ? "  ★" : ""}
                </option>
              ),
            )}
          </select>
          <button type="button" className="newdoc-showall" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Sort by match" : "Show all A–Z"}
          </button>
        </div>
      )}

      <div className="newdoc-key" title="Where the note will be created">
        {derivedKey}
      </div>

      {error && <div className="newdoc-error">{error}</div>}

      <div className="newdoc-actions">
        <button type="button" className="vault-btn primary" onClick={() => void useTemplate()} disabled={busy}>
          {selected ? "Use template" : "Create"}
        </button>
        {onDraftWithAI && (
          <button
            type="button"
            className="vault-btn"
            onClick={() => onDraftWithAI({ intent: intent.trim(), folder: folder.trim(), template: selected })}
            disabled={busy}
          >
            Draft with AI
          </button>
        )}
        {selected && (
          <button type="button" className="vault-btn ghost" onClick={blankNote} disabled={busy}>
            Blank note
          </button>
        )}
        <button type="button" className="vault-btn ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
