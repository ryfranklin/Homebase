import { useMemo, useState } from "react";

import type { AppMode } from "./ModeSwitch";
import { ModeSwitch } from "./ModeSwitch";
import type { UseEvals } from "../evals/useEvals";
import type { CaseRecord, RunPayload, Scorecard } from "../evals/types";

// The Evals surface: a run picker plus the full diagnostics for one run —
// leaderboard, capability heatmap, quality-vs-cost scatter, latency bars, and a
// filterable per-case drill-down. Same views (and payload) as the standalone
// dashboard the harness generates.

const shortModel = (m: string) => m.replace(/^(us|eu|apac|global)\./, "");
const fmt = (x: number, d = 3) => Number(x).toFixed(d);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const money = (x: number) => `$${Number(x).toFixed(5)}`;
function qColor(q: number): string {
  const r = Math.round(248 + (63 - 248) * q);
  const g = Math.round(81 + (185 - 81) * q);
  const b = Math.round(73 + (80 - 73) * q);
  return `rgb(${r},${g},${b})`;
}

export function EvalsView({
  evals,
  onNavigate,
  onSignOut,
  onOpenSettings,
}: {
  evals: UseEvals;
  onNavigate: (mode: AppMode) => void;
  onSignOut: () => void;
  onOpenSettings?: () => void;
}) {
  const { runs, selected, selectedId, sample, error, select } = evals;

  return (
    <div className="ev">
      <header className="chat-header">
        <span className="wordmark">Homebase</span>
        <div className="header-actions">
          <ModeSwitch active="evals" onNavigate={onNavigate} onOpenSettings={onOpenSettings} />
          <button type="button" className="link-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="ev-body">
        <div className="ev-toolbar">
          <div>
            <label className="ev-label" htmlFor="ev-run">
              Run
            </label>
            <select
              id="ev-run"
              className="ev-select"
              value={selectedId ?? ""}
              onChange={(e) => void select(e.target.value)}
            >
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.suite} · {shortModel(r.topModel ?? "")} q{r.topQuality != null ? fmt(r.topQuality, 2) : "?"} · {r.createdAt}
                </option>
              ))}
            </select>
          </div>
          {sample && <span className="ev-badge">sample data{error ? ` — ${error}` : ""}</span>}
        </div>

        {selected ? <RunDashboard payload={selected} /> : <div className="ev-empty">No run selected.</div>}
      </div>
    </div>
  );
}

function RunDashboard({ payload }: { payload: RunPayload }) {
  const { meta, scorecards, tags, cases } = payload;
  const models = useMemo(() => scorecards.map((c) => c.model), [scorecards]);
  const [filterModel, setFilterModel] = useState("");
  const [filterTag, setFilterTag] = useState("");

  const focusCases = (model: string, tag: string) => {
    setFilterModel(model);
    setFilterTag(tag);
    document.getElementById("ev-cases")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <>
      <div className="ev-meta">
        <span className="ev-chip">suite <b>{meta.suite}</b></span>
        <span className="ev-chip">judge <b>{shortModel(meta.judge)}</b></span>
        <span className="ev-chip">cases <b>{meta.n_cases}</b></span>
        <span className="ev-chip">generated <b>{meta.generated_at}</b></span>
      </div>

      <section className="ev-card">
        <h2>Leaderboard</h2>
        <Leaderboard cards={scorecards} />
      </section>

      <div className="ev-grid">
        <section className="ev-card">
          <h2>Capability heatmap</h2>
          <Heatmap models={models} tags={tags} onCell={focusCases} />
          <p className="ev-legend">Green higher, red lower. Click a cell to filter the cases below.</p>
        </section>
        <section className="ev-card">
          <h2>Quality vs cost</h2>
          <Scatter cards={scorecards} />
          <p className="ev-legend">Up and left is better. Point size = p50 latency.</p>
        </section>
      </div>

      <section className="ev-card">
        <h2>Latency by model (p50 / p95, ms)</h2>
        <LatencyBars cards={scorecards} />
      </section>

      <section className="ev-card" id="ev-cases">
        <h2>Case drill-down</h2>
        <CaseDrilldown
          cases={cases}
          models={models}
          tags={tags.map((t) => t.tag)}
          filterModel={filterModel}
          filterTag={filterTag}
          setFilterModel={setFilterModel}
          setFilterTag={setFilterTag}
        />
      </section>
    </>
  );
}

type SortKey = keyof Scorecard;

function Leaderboard({ cards }: { cards: Scorecard[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("avg_quality");
  const [desc, setDesc] = useState(true);
  const cols: { key: SortKey; label: string }[] = [
    { key: "model", label: "model" },
    { key: "avg_quality", label: "quality" },
    { key: "success_rate", label: "success" },
    { key: "p50_latency_ms", label: "p50 ms" },
    { key: "p95_latency_ms", label: "p95 ms" },
    { key: "avg_cost_usd", label: "avg $" },
    { key: "total_cost_usd", label: "total $" },
    { key: "n_errors", label: "err" },
  ];
  const rows = useMemo(() => {
    const dir = desc ? -1 : 1;
    return [...cards].sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * dir);
  }, [cards, sortKey, desc]);
  const onSort = (k: SortKey) => (k === sortKey ? setDesc((d) => !d) : (setSortKey(k), setDesc(true)));

  return (
    <table className="ev-table">
      <thead>
        <tr>
          <th className="ev-rankn">#</th>
          {cols.map((c) => (
            <th key={c.key} className={c.key === sortKey ? "ev-sorted" : undefined} onClick={() => onSort(c.key)}>
              {c.label}
              {c.key === sortKey ? (desc ? " ▾" : " ▴") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((c, i) => (
          <tr key={c.model}>
            <td className="ev-rankn">{i + 1}</td>
            <td><code>{shortModel(c.model)}</code></td>
            <td>
              <span className="ev-barwrap">
                <span className="ev-bar" style={{ width: `${Math.max(2, c.avg_quality * 90)}px` }} />
              </span>
              {fmt(c.avg_quality)}
            </td>
            <td>{pct(c.success_rate)}</td>
            <td>{Math.round(c.p50_latency_ms)}</td>
            <td>{Math.round(c.p95_latency_ms)}</td>
            <td>{money(c.avg_cost_usd)}</td>
            <td>{money(c.total_cost_usd)}</td>
            <td style={{ color: c.n_errors ? "var(--danger)" : undefined }}>{c.n_errors}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Heatmap({
  models,
  tags,
  onCell,
}: {
  models: string[];
  tags: RunPayload["tags"];
  onCell: (model: string, tag: string) => void;
}) {
  const val: Record<string, Record<string, number>> = {};
  for (const t of tags) {
    val[t.tag] = {};
    for (const r of t.rows) val[t.tag][r.model] = r.quality;
  }
  return (
    <div className="ev-scroll">
      <table className="ev-heat">
        <thead>
          <tr>
            <th>model \ tag</th>
            {tags.map((t) => (
              <th key={t.tag}>{t.tag}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m}>
              <td className="ev-lab"><code>{shortModel(m)}</code></td>
              {tags.map((t) => {
                const q = val[t.tag]?.[m];
                return q == null ? (
                  <td key={t.tag}>·</td>
                ) : (
                  <td
                    key={t.tag}
                    title={`${shortModel(m)} · ${t.tag}: ${fmt(q)}`}
                    onClick={() => onCell(m, t.tag)}
                    style={{ background: qColor(q), color: q > 0.55 ? "#06210f" : "#3a0d0d", cursor: "pointer" }}
                  >
                    {fmt(q, 2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Scatter({ cards }: { cards: Scorecard[] }) {
  const W = 460;
  const H = 260;
  const pad = 42;
  const maxC = Math.max(...cards.map((c) => c.avg_cost_usd), 1e-6) * 1.15;
  const maxL = Math.max(...cards.map((c) => c.p50_latency_ms), 1);
  const x = (c: Scorecard) => pad + (c.avg_cost_usd / maxC) * (W - pad - 16);
  const y = (c: Scorecard) => H - pad - c.avg_quality * (H - pad - 16);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="ev-svg">
      <line x1={pad} y1={H - pad} x2={W - 8} y2={H - pad} stroke="#2a3444" />
      <line x1={pad} y1={8} x2={pad} y2={H - pad} stroke="#2a3444" />
      <text x={W / 2} y={H - 8} textAnchor="middle">avg cost per call (USD) →</text>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => {
        const yy = H - pad - g * (H - pad - 16);
        return (
          <g key={g}>
            <line x1={pad} y1={yy} x2={W - 8} y2={yy} stroke="#161c27" />
            <text x={pad - 6} y={yy + 3} textAnchor="end">{g}</text>
          </g>
        );
      })}
      {cards.map((c) => {
        const r = 5 + (c.p50_latency_ms / maxL) * 10;
        return (
          <g key={c.model}>
            <circle cx={x(c)} cy={y(c)} r={r} fill={qColor(c.avg_quality)} fillOpacity={0.8} stroke="#0b0e14">
              <title>{`${shortModel(c.model)} — q ${fmt(c.avg_quality)}, ${money(c.avg_cost_usd)}, p50 ${Math.round(c.p50_latency_ms)}ms`}</title>
            </circle>
            <text x={x(c) + r + 4} y={y(c) + 3} className="ev-dotlabel">{shortModel(c.model)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LatencyBars({ cards }: { cards: Scorecard[] }) {
  const maxL = Math.max(...cards.map((c) => c.p95_latency_ms), 1);
  return (
    <div className="ev-latency">
      {cards.map((c) => (
        <div key={c.model} className="ev-latrow">
          <div className="ev-latname"><code>{shortModel(c.model)}</code></div>
          <div className="ev-lattrack">
            <div className="ev-latp95" style={{ width: `${(c.p95_latency_ms / maxL) * 100}%` }} title={`p95 ${Math.round(c.p95_latency_ms)}ms`} />
            <div className="ev-latp50" style={{ width: `${(c.p50_latency_ms / maxL) * 100}%` }} title={`p50 ${Math.round(c.p50_latency_ms)}ms`} />
          </div>
          <div className="ev-latval">p50 {Math.round(c.p50_latency_ms)} · p95 {Math.round(c.p95_latency_ms)}</div>
        </div>
      ))}
    </div>
  );
}

function CaseDrilldown({
  cases,
  models,
  tags,
  filterModel,
  filterTag,
  setFilterModel,
  setFilterTag,
}: {
  cases: CaseRecord[];
  models: string[];
  tags: string[];
  filterModel: string;
  filterTag: string;
  setFilterModel: (v: string) => void;
  setFilterTag: (v: string) => void;
}) {
  const [result, setResult] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const key = (c: CaseRecord) => `${c.model}::${c.case_id}`;

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return cases
      .filter(
        (c) =>
          (!filterModel || c.model === filterModel) &&
          (!filterTag || c.tags.includes(filterTag)) &&
          (!result || (result === "pass" ? c.success : !c.success)) &&
          (!q || `${c.case_id} ${c.prompt} ${c.response}`.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.quality - b.quality);
  }, [cases, filterModel, filterTag, result, search]);

  const toggle = (k: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  return (
    <>
      <div className="ev-controls">
        <select className="ev-select" value={filterModel} onChange={(e) => setFilterModel(e.target.value)}>
          <option value="">all models</option>
          {models.map((m) => (
            <option key={m} value={m}>{shortModel(m)}</option>
          ))}
        </select>
        <select className="ev-select" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
          <option value="">all capabilities</option>
          {tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className="ev-select" value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="">all results</option>
          <option value="pass">pass only</option>
          <option value="fail">fail only</option>
        </select>
        <input
          className="ev-search"
          type="search"
          placeholder="search prompt / response / case id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ev-legend">{rows.length} / {cases.length} cases</span>
      </div>
      <table className="ev-table">
        <thead>
          <tr>
            <th>case</th>
            <th>model</th>
            <th>quality</th>
            <th>result</th>
            <th>ms</th>
            <th>$</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const k = key(c);
            const open = expanded.has(k);
            return (
              <>
                <tr key={k} className="ev-caserow" onClick={() => toggle(k)}>
                  <td><code>{c.case_id}</code></td>
                  <td><code>{shortModel(c.model)}</code></td>
                  <td style={{ color: qColor(c.quality) }}>{fmt(c.quality)}</td>
                  <td>
                    <span className={`ev-pill ${c.success ? "pass" : "fail"}`}>{c.success ? "pass" : "fail"}</span>
                  </td>
                  <td>{Math.round(c.latency_ms)}</td>
                  <td>{money(c.cost_usd)}</td>
                </tr>
                {open && (
                  <tr key={`${k}-d`} className="ev-detail">
                    <td colSpan={6}>
                      <div className="ev-kv">
                        <span className="ev-k">tags</span>
                        <span>{c.tags.join(", ") || "—"}</span>
                        <span className="ev-k">judge</span>
                        <span className="ev-legend">{c.rationale || "—"}</span>
                        <span className="ev-k">tokens</span>
                        <span className="ev-legend">{c.input_tokens} in / {c.output_tokens} out</span>
                      </div>
                      <div className="ev-k">prompt</div>
                      <pre className="ev-pre">{c.prompt}</pre>
                      <div className="ev-k">response</div>
                      <pre className="ev-pre">{c.response || (c.error ? `[error] ${c.error}` : "")}</pre>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
