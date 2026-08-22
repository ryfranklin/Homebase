import { lazy, Suspense, useState } from "react";

import { ModeSwitch, type AppMode } from "./ModeSwitch";
import { isTerminal, type Run, type RunChanges, type RunEvent } from "../missions/types";
import type { UseMissions } from "../missions/useMissions";

// The worker's result is markdown; render it like the chat transcript does. Lazy so
// the markdown/highlight chunk stays out of the initial bundle.
const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })));

// The Mission Control observation deck: launch a run against a target repo, watch its
// priced telemetry stream, and drive the go/no-go gate. The BFF relays to the
// execution engine; this is Homebase's ground-station view of a mission in flight.

function statusClass(status: string): string {
  if (status === "awaiting_gate") return "mc-status gate";
  if (status === "failed" || status === "scrubbed" || status === "merge_conflict" || status === "push_rejected") return "mc-status bad";
  if (status === "applied" || status === "done") return "mc-status good";
  return "mc-status live";
}

function money(n: number | null | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(4)}` : "—";
}

// One telemetry frame -> a compact line.
function eventLine(evt: RunEvent): string {
  const d = (evt.data ?? {}) as Record<string, unknown>;
  if (evt.type === "step_metric") {
    const step = (d.event ?? d) as Record<string, unknown>;
    const cost = typeof step.cost_usd === "number" ? `$${(step.cost_usd as number).toFixed(4)}` : "";
    return `step · ${step.model ?? ""} ${cost}`.trim();
  }
  if (evt.type === "node_transition") return `→ ${d.node ?? "node"}`;
  if (evt.type === "gate_waiting") return "⏸ awaiting go/no-go";
  if (evt.type === "error") return `error: ${d.message ?? ""}`;
  return evt.type;
}

function LaunchForm({ onLaunch }: { onLaunch: (t: string, k: "sim" | "burn", p: string) => void }) {
  const [target, setTarget] = useState("");
  const [taskType, setTaskType] = useState<"sim" | "burn">("sim");
  const [prompt, setPrompt] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target.trim() || !prompt.trim()) return;
    onLaunch(target.trim(), taskType, prompt.trim());
  };
  return (
    <form className="mc-launch" onSubmit={submit}>
      <input className="mc-input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="target repo (https git url)" aria-label="Target repo" />
      <div className="mc-launch-row">
        <select className="mc-input mc-select" value={taskType} onChange={(e) => setTaskType(e.target.value as "sim" | "burn")} aria-label="Task type">
          <option value="sim">sim (read-only)</option>
          <option value="burn">burn (gated write)</option>
        </select>
        <button type="submit" className="vault-btn primary" disabled={!target.trim() || !prompt.trim()}>
          Launch
        </button>
      </div>
      <textarea className="mc-input mc-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should the worker do?" rows={2} aria-label="Prompt" />
    </form>
  );
}

// The run's final result. The worker returns markdown, and it can be long, so this
// renders it formatted inside a bounded, scrollable panel that expands to full height
// on demand and offers copy-to-clipboard — a long result is contained, never clipped
// with no way to see the rest. A "… (result truncated)" marker from the engine (when a
// summary overran its cap) renders inline as the italic it is.
function ResultPanel({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context / denied); the text is still selectable */
    }
  };

  return (
    <div className={`mc-result${expanded ? " expanded" : ""}`}>
      <div className="mc-result-head">
        <span className="mc-result-label">Result</span>
        <div className="mc-result-actions">
          <button type="button" className="link-button" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="link-button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>
      <div className="mc-result-body">
        <Suspense fallback={<div className="prose">{text}</div>}>
          <Markdown text={text} />
        </Suspense>
      </div>
    </div>
  );
}

// The diff a burn produced: what the reviewer is actually approving at the gate. Shows
// the commit message, a per-file +/- summary, and the full unified diff on demand.
function ChangesPanel({ changes }: { changes: RunChanges }) {
  const [showPatch, setShowPatch] = useState(false);
  const files = changes.files ?? [];
  const count = changes.file_count ?? files.length;
  if (files.length === 0 && !changes.patch) {
    return <p className="mc-empty">No file changes were recorded for this run.</p>;
  }
  return (
    <div className="mc-changes">
      <div className="mc-changes-head">
        <span className="mc-changes-title">Changes to review</span>
        <span className="mc-changes-count">
          {count} file{count === 1 ? "" : "s"}
        </span>
      </div>
      {changes.message && <div className="mc-changes-msg">{changes.message}</div>}
      {files.length > 0 && (
        <ul className="mc-changes-files">
          {files.map((f, i) => (
            <li key={i} className="mc-changes-file">
              <span className="mc-changes-path">{f.path}</span>
              <span className="mc-changes-nums">
                {f.added !== "-" && <span className="mc-add">+{f.added}</span>}
                {f.removed !== "-" && <span className="mc-del">−{f.removed}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {changes.patch && (
        <div className="mc-changes-diff">
          <button type="button" className="link-button" onClick={() => setShowPatch((v) => !v)}>
            {showPatch ? "Hide diff" : "View diff"}
          </button>
          {showPatch && (
            <pre className="mc-diff">
              {changes.patch}
              {changes.truncated ? "\n… (diff truncated)" : ""}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function RunDetail({
  run,
  events,
  changes,
  onDecide,
}: {
  run: Run;
  events: RunEvent[];
  changes: RunChanges | null;
  onDecide: (d: "approve" | "reject") => void;
}) {
  const gating = run.status === "awaiting_gate";
  return (
    <div className="mc-detail">
      <div className="mc-detail-head">
        <div>
          <div className="mc-detail-title">{run.subject || run.run_id}</div>
          <div className="mc-detail-sub">
            {run.task_type} · {run.target}
          </div>
        </div>
        <div className="mc-detail-meta">
          <span className={statusClass(run.status)}>{run.status.replace(/_/g, " ")}</span>
          <span className="mc-cost">{money(run.cost_usd)}</span>
        </div>
      </div>

      {changes && <ChangesPanel changes={changes} />}

      {gating && (
        <div className="mc-gate">
          <span>{changes ? "Review the changes above, then decide." : "This burn is paused at the go/no-go gate."}</span>
          <div className="mc-gate-actions">
            <button type="button" className="vault-btn primary" onClick={() => onDecide("approve")}>
              Approve (go)
            </button>
            <button type="button" className="vault-btn danger" onClick={() => onDecide("reject")}>
              Reject (no-go)
            </button>
          </div>
        </div>
      )}

      <div className="mc-telemetry">
        <div className="mc-telemetry-head">Telemetry {!isTerminal(run.status) && <span className="mc-live-dot" aria-hidden="true" />}</div>
        {events.length === 0 ? (
          <p className="mc-empty">Waiting for the first event…</p>
        ) : (
          <ul className="mc-events">
            {events.map((e, i) => (
              <li key={i} className={`mc-event mc-${e.type}`}>
                {eventLine(e)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {run.detail && isTerminal(run.status) && <ResultPanel text={run.detail} />}
    </div>
  );
}

export function MissionControl({
  missions,
  onNavigate,
  onSignOut,
  onOpenSettings,
}: {
  missions: UseMissions;
  onNavigate?: (mode: AppMode) => void;
  onSignOut?: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <div className="plan">
      <header className="chat-header">
        <span className="wordmark">
          <span className="wordmark-dot" aria-hidden="true"></span>
          Homebase
        </span>
        <div className="header-actions">
          {missions.error && <span className="plan-save-error">{missions.error}</span>}
          {onNavigate && <ModeSwitch active="mission" onNavigate={onNavigate} onOpenSettings={onOpenSettings} />}
          {onSignOut && (
            <button type="button" className="link-button" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

      <div className="plan-body">
        <div className="mc">
          <aside className="mc-side">
            <LaunchForm onLaunch={(t, k, p) => void missions.launch({ target: t, taskType: k, prompt: p })} />
            <div className="mc-runs-head">
              <span>Runs</span>
              <button type="button" className="link-button" onClick={() => void missions.refresh()}>
                Refresh
              </button>
            </div>
            {missions.runs.length === 0 ? (
              <p className="mc-empty">No runs yet. Launch one above.</p>
            ) : (
              <ul className="mc-runs">
                {missions.runs.map((r) => (
                  <li key={r.run_id}>
                    <button
                      type="button"
                      className={`mc-run${missions.selected?.run_id === r.run_id ? " active" : ""}`}
                      onClick={() => void missions.select(r.run_id)}
                    >
                      <span className="mc-run-title">{r.subject || r.target || r.run_id}</span>
                      <span className="mc-run-meta">
                        <span className={statusClass(r.status)}>{r.status.replace(/_/g, " ")}</span>
                        <span className="mc-cost">{money(r.cost_usd)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <main className="mc-main">
            {missions.selected ? (
              <RunDetail
                run={missions.selected}
                events={missions.events}
                changes={missions.changes}
                onDecide={(d) => void missions.decide(missions.selected!.run_id, d)}
              />
            ) : (
              <div className="mc-placeholder">
                <h1>Mission Control</h1>
                <p>Launch a run or select one to watch its telemetry and drive the go/no-go gate.</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
