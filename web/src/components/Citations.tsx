import type { Citation } from "../api/types";
import { dedupeCitations } from "../chat/messages";

// Show just the file/leaf name on the chip, with the full path as the title.
function leaf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function Citations({ citations }: { citations: Citation[] }) {
  const unique = dedupeCitations(citations);
  if (unique.length === 0) return null;
  return (
    <div className="citations" aria-label="Sources">
      <span className="citations-label">Sources</span>
      <ul>
        {unique.map((c) => (
          <li key={c.sourcePath} className="citation" title={c.sourcePath}>
            <span className="citation-dot" aria-hidden="true"></span>
            <span className="citation-name">{leaf(c.sourcePath)}</span>
            <span className="citation-path">{c.sourcePath}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
