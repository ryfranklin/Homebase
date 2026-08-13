import { timeAgo } from "../vault/format";
import type { NoteVersion } from "../vault/types";

// A modal listing a note's version history (S3 object versions), each attributed
// to its author, with restore for any non-current version.
export function VaultHistory({
  versions,
  onRestore,
  onClose,
}: {
  versions: NoteVersion[];
  onRestore: (versionId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="vault-history-overlay" role="dialog" aria-label="Note history" onClick={onClose}>
      <div className="vault-history" onClick={(e) => e.stopPropagation()}>
        <div className="vault-history-head">
          <h3>History</h3>
          <button type="button" className="link-button" onClick={onClose}>
            Close
          </button>
        </div>
        {versions.length === 0 ? (
          <p className="vault-history-empty">No prior versions.</p>
        ) : (
          <ul className="vault-history-list">
            {versions.map((v) => (
              <li key={v.versionId} className="vault-version">
                <div className="vault-version-meta">
                  <span className="vault-version-who">{v.updatedBy || "unknown"}</span>
                  <span className="vault-version-when">{timeAgo(v.updatedAt)}</span>
                  {v.isCurrent && <span className="vault-version-current">current</span>}
                </div>
                {!v.isCurrent && (
                  <button type="button" className="vault-btn" onClick={() => onRestore(v.versionId)}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
