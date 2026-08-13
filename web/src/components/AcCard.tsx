import type { AcceptanceCriterion, AcStatus, Contributor } from "../plan/types";

const STATUS_LABEL: Record<AcStatus, string> = {
  proposed: "proposed",
  approved: "approved",
  needs_revision: "needs revision",
  rejected: "rejected",
};

function Author({ who }: { who: Contributor }) {
  return (
    <span className={`ac-author ${who.kind}`}>
      {who.kind === "agent" && <span className="ac-agent-dot" aria-hidden="true" />}
      {who.name}
    </span>
  );
}

export type GateAction = "approve" | "revise" | "reject";

export function AcCard({
  ac,
  onGate,
  onOpenSource,
}: {
  ac: AcceptanceCriterion;
  onGate: (id: string, action: GateAction) => void;
  onOpenSource?: (slug: string) => void;
}) {
  const gateable = ac.status === "proposed" || ac.status === "needs_revision";
  return (
    <article className={`ac-card status-${ac.status}`}>
      <header className="ac-head">
        <span className="ac-id">{ac.id}</span>
        <span className={`ac-status status-${ac.status}`}>{STATUS_LABEL[ac.status]}</span>
        <Author who={ac.author} />
      </header>

      <p className="ac-statement">{ac.statement}</p>

      {ac.rationale && <p className="ac-rationale">{ac.rationale}</p>}

      {(ac.links.length > 0 || ac.comments.length > 0) && (
        <div className="ac-meta">
          {ac.links.map((l) =>
            onOpenSource ? (
              <button key={l} type="button" className="ac-link linkable" onClick={() => onOpenSource(l)}>
                [[{l}]]
              </button>
            ) : (
              <span key={l} className="ac-link">
                [[{l}]]
              </span>
            ),
          )}
          {ac.comments.length > 0 && <span className="ac-comments">{ac.comments.length} note{ac.comments.length === 1 ? "" : "s"}</span>}
        </div>
      )}

      {ac.comments.length > 0 && (
        <div className="ac-thread">
          {ac.comments.map((c, i) => (
            <div key={i} className="ac-comment">
              <Author who={c.author} />
              <span className="ac-comment-text">{c.text}</span>
            </div>
          ))}
        </div>
      )}

      {gateable && (
        <div className="ac-gate" aria-label="Review gate">
          <button type="button" className="ac-btn approve" onClick={() => onGate(ac.id, "approve")}>
            Approve
          </button>
          <button type="button" className="ac-btn" onClick={() => onGate(ac.id, "revise")}>
            Request revision
          </button>
          <button type="button" className="ac-btn reject" onClick={() => onGate(ac.id, "reject")}>
            Reject
          </button>
        </div>
      )}
    </article>
  );
}
