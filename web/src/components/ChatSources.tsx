import { dedupeCitations, type ChatMessage } from "../chat/messages";
import { computeSourceStates } from "../chat/sources";

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

// A live "network tree" beside the chat: the Homebase hub branching to each source,
// lighting up as the agent pulls from them (active = pulling now, used = pulled this
// conversation). The cited vault docs hang under the Vault node as leaves.
export function ChatSources({ messages, streaming }: { messages: ChatMessage[]; streaming: boolean }) {
  const states = computeSourceStates(messages, streaming);
  const citations = dedupeCitations(messages.flatMap((m) => m.citations));
  const pulling = states.some((s) => s.active);

  return (
    <aside className="chat-sources" aria-label="Data sources">
      <div className="cs-head">
        <span className="cs-hub">
          <span className="cs-hub-dot" aria-hidden="true" />
          Homebase
        </span>
        {pulling ? (
          <span className="cs-live" role="status">
            <span className="cs-live-dot" aria-hidden="true" />
            pulling
          </span>
        ) : (
          <span className="cs-idle-label">sources</span>
        )}
      </div>

      <ul className="cs-tree">
        {states.map((s, i) => {
          const state = s.active ? "active" : s.used ? "used" : "idle";
          const last = i === states.length - 1;
          return (
            <li key={s.id} className={`cs-node ${state}`}>
              <span className={`cs-branch${last ? " last" : ""}`} aria-hidden="true" />
              <span className="cs-connector" aria-hidden="true" />
              <span className="cs-dot" aria-hidden="true" />
              <span className="cs-label">{s.label}</span>
              {s.count > 0 && <span className="cs-count">{s.count}</span>}

              {s.id === "kb" && citations.length > 0 && (
                <ul className="cs-leaves">
                  {citations.map((c) => (
                    <li key={c.sourcePath} className="cs-leaf" title={c.sourcePath}>
                      {baseName(c.sourcePath)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
