// A small animated node graph: Homebase at the centre, its connected services
// orbiting, with edges that pulse inward to suggest data flowing in. Decorative
// (aria-hidden); shown on the empty state.

const SERVICES = ["Notes", "Gmail", "Calendar", "Drive", "Slack", "Jira", "Confluence"];

const W = 380;
const H = 300;
const CX = W / 2;
const CY = H / 2;
const RX = 150;
const RY = 108;

export function ServiceNetwork() {
  const nodes = SERVICES.map((label, i) => {
    const angle = (-90 + (360 / SERVICES.length) * i) * (Math.PI / 180);
    const x = CX + RX * Math.cos(angle);
    const y = CY + RY * Math.sin(angle);
    const anchor = x < CX - 12 ? "end" : x > CX + 12 ? "start" : "middle";
    const lx = x + (anchor === "start" ? 12 : anchor === "end" ? -12 : 0);
    const ly = y + (y < CY - 12 ? -12 : y > CY + 12 ? 20 : 4);
    return { label, x, y, lx, ly, anchor, i };
  });

  return (
    <div className="service-network" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
        <g className="edges">
          {nodes.map((n) => (
            <line
              key={n.label}
              className="edge"
              x1={n.x}
              y1={n.y}
              x2={CX}
              y2={CY}
              style={{ animationDelay: `${n.i * 0.28}s` }}
            />
          ))}
        </g>

        <g className="nodes">
          {nodes.map((n) => (
            <g key={n.label} className="node">
              <circle className="node-halo" cx={n.x} cy={n.y} r="10" style={{ animationDelay: `${n.i * 0.24}s` }} />
              <circle className="node-dot" cx={n.x} cy={n.y} r="4.5" />
              <text
                className="node-label"
                x={n.lx}
                y={n.ly}
                textAnchor={n.anchor as "start" | "middle" | "end"}
              >
                {n.label}
              </text>
            </g>
          ))}
        </g>

        <g className="core">
          <circle className="core-ring" cx={CX} cy={CY} r="30" />
          <circle className="core-glow" cx={CX} cy={CY} r="16" />
          <circle className="core-dot" cx={CX} cy={CY} r="9" />
          <text className="core-label" x={CX} y={CY + 50} textAnchor="middle">
            Homebase
          </text>
        </g>
      </svg>
    </div>
  );
}
