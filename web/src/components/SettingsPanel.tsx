import { useEffect, useState } from "react";

import { setGithubToken } from "../api/settings";

// A small settings overlay. Today it holds the Mission Control GitHub token: paste a
// token, save, and the BFF writes it to Secrets Manager and restarts Mission Control.
// The token is write-only — never fetched or displayed, so the field starts empty.
export function SettingsPanel({
  apiBaseUrl,
  getToken,
  onClose,
}: {
  apiBaseUrl: string;
  getToken: () => Promise<string>;
  onClose: () => void;
}) {
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      await setGithubToken(apiBaseUrl, getToken, token.trim());
      setToken("");
      setStatus({ kind: "ok", text: "Saved. Mission Control is restarting to pick it up (~1-2 min)." });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : "save failed" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
      <div className="settings-card" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <h2>Settings</h2>
          <button type="button" className="link-button" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        <form className="settings-section" onSubmit={save}>
          <label className="settings-label" htmlFor="gh-token">
            Mission Control GitHub token
          </label>
          <p className="settings-hint">
            Used to clone your target repos. Needs read access to those repos (public read for
            public repos; <code>Contents: read</code> for private). Stored as a secret, never shown
            again.
          </p>
          <input
            id="gh-token"
            className="settings-input"
            type="password"
            autoComplete="off"
            placeholder="ghp_… or a fine-grained token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-label="GitHub token"
          />
          <div className="settings-actions">
            <button type="submit" className="vault-btn primary" disabled={!token.trim() || saving}>
              {saving ? "Saving…" : "Save & restart Mission Control"}
            </button>
          </div>
          {status && (
            <p className={status.kind === "ok" ? "settings-status ok" : "settings-status err"} role="status">
              {status.text}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
