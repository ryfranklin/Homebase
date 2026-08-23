import { useState } from "react";

import { waypointCriteria, waypointPhase, waypointTitle, type Waypoint } from "../plan/types";
import { buildPlanGraph, toneForStatus, TONE_HEX, type PlanGraphNode } from "../plan/planGraph";

// Grid geometry (px). Node pitch = size + gap.
const NODE_W = 184;
const NODE_H = 62;
const COL_GAP = 56;
const ROW_GAP = 18;
const PAD = 12;

const colX = (level: number) => PAD + level * (NODE_W + COL_GAP);
const rowY = (row: number) => PAD + row * (NODE_H + ROW_GAP);

const STATUS_GLYPH: Record<string, string> = { good: "✓", bad: "✕", gate: "⚑", live: "●", idle: "○" };

// The plan route drawn as a node graph: units flow left to right along the sequence, with
// SVG connectors behind HTML node cards. Nodes carry the unit's Mission Control status as
// a border tone + glyph (never hue alone). Clicking a node opens a compact detail panel
// with its phase, status, criteria count, and the launch / view-flight actions.
export function PlanGraph({
  route,
  target,
  unitStatus,
  onLaunchUnit,
  onViewRun,
}: {
  route: (string | Waypoint)[];
  target?: string;
  unitStatus?: (unitTitle: string) => { status: string; runId: string } | undefined;
  onLaunchUnit?: (wp: string | Waypoint) => void;
  onViewRun?: (runId: string) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const graph = buildPlanGraph(route);
  if (graph.nodes.length === 0) {
    return <p className="fp-prose fp-muted">No route units yet. Add units to see the plan graph.</p>;
  }

  const width = PAD * 2 + graph.cols * NODE_W + Math.max(0, graph.cols - 1) * COL_GAP;
  const height = PAD * 2 + graph.rows * NODE_H + Math.max(0, graph.rows - 1) * ROW_GAP;
  const place = new Map<number, PlanGraphNode>(graph.nodes.map((n) => [n.index, n]));
  const sel = selected != null ? place.get(selected) : undefined;
  const selWp = selected != null ? route[selected] : undefined;
  const selStatus = selWp != null ? unitStatus?.(waypointTitle(selWp)) : undefined;

  return (
    <div className="pg">
      <div className="pg-scroll">
        <div className="pg-canvas" style={{ width, height }}>
          <svg className="pg-edges" width={width} height={height} aria-hidden="true">
            <defs>
              <marker id="pg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 Z" fill={TONE_HEX.live} />
              </marker>
            </defs>
            {graph.edges.map((e) => {
              const from = place.get(e.from);
              const to = place.get(e.to);
              if (!from || !to) return null;
              const x1 = colX(from.level) + NODE_W;
              const y1 = rowY(from.row) + NODE_H / 2;
              const x2 = colX(to.level);
              const y2 = rowY(to.row) + NODE_H / 2;
              const dx = Math.max(24, (x2 - x1) / 2);
              const active = e.from === selected || e.to === selected;
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={active ? "#8b93d6" : TONE_HEX.live}
                  strokeWidth={active ? 1.75 : 1.25}
                  strokeOpacity={active ? 0.95 : 0.6}
                  markerEnd="url(#pg-arrow)"
                />
              );
            })}
          </svg>
          {graph.nodes.map((n) => {
            const st = unitStatus?.(n.title);
            const tone = toneForStatus(st?.status);
            return (
              <button
                key={n.index}
                type="button"
                className={`pg-node ${tone}${n.index === selected ? " selected" : ""}`}
                style={{ left: colX(n.level), top: rowY(n.row), width: NODE_W, height: NODE_H }}
                onClick={() => setSelected((cur) => (cur === n.index ? null : n.index))}
                aria-haspopup="dialog"
                title={`${n.title}${st ? ` — ${st.status.replace(/_/g, " ")}` : ""}`}
              >
                <span className="pg-node-top">
                  <span className="pg-seq">{String(n.index + 1).padStart(2, "0")}</span>
                  <span className="pg-title">{n.title}</span>
                  <span className={`pg-glyph ${tone}`} aria-hidden="true">
                    {STATUS_GLYPH[tone]}
                  </span>
                </span>
                <span className="pg-node-bot">
                  {n.phase && <span className={`fp-phase ${n.phase.toLowerCase()}`}>{n.phase === "INCEPTION" ? "sim" : "burn"}</span>}
                  {n.criteriaCount > 0 && <span className="pg-crit">{n.criteriaCount} AC</span>}
                  {st && <span className="pg-node-status">{st.status.replace(/_/g, " ")}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {sel && selWp != null && (
        <div className="pg-detail" role="dialog" aria-label={`Unit ${sel.index + 1}`}>
          <div className="pg-detail-head">
            <span className="pg-detail-eyebrow">Unit {String(sel.index + 1).padStart(2, "0")}</span>
            <button type="button" className="pg-detail-close" onClick={() => setSelected(null)} aria-label="Close">
              ×
            </button>
          </div>
          <h3 className="pg-detail-title">{waypointTitle(selWp)}</h3>
          <dl className="pg-detail-grid">
            <div>
              <dt>Phase</dt>
              <dd>{waypointPhase(selWp) || "—"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{selStatus ? selStatus.status.replace(/_/g, " ") : "not launched"}</dd>
            </div>
            <div>
              <dt>Acceptance criteria</dt>
              <dd>{(waypointCriteria(selWp) ?? []).length || "inherits the plan's"}</dd>
            </div>
          </dl>
          <div className="pg-detail-actions">
            {selStatus && onViewRun && (
              <button type="button" className="fp-run live" onClick={() => onViewRun(selStatus.runId)}>
                View flight ↗
              </button>
            )}
            {onLaunchUnit && target && (
              <button type="button" className="fp-launch" onClick={() => onLaunchUnit(selWp)}>
                Launch ↗
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
