import type { Citation } from "../api/types";
import { dedupeCitations } from "../chat/messages";

export function Citations({ citations }: { citations: Citation[] }) {
  const unique = dedupeCitations(citations);
  if (unique.length === 0) return null;
  return (
    <div className="citations" aria-label="Sources">
      <span className="citations-label">Sources</span>
      <ul>
        {unique.map((c) => (
          <li key={c.sourcePath} className="citation" title={c.sourcePath}>
            {c.sourcePath}
          </li>
        ))}
      </ul>
    </div>
  );
}
