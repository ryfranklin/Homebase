"""Render a self-contained interactive HTML dashboard from a benchmark run.

The dashboard is a single file with no external dependencies (no CDN, no build
step): the run data is embedded as JSON and vanilla JS + inline SVG draw the
leaderboard, capability heatmap, quality-vs-cost scatter, latency bars, and a
filterable per-case drill-down. This matches the repo's self-contained
architecture.html convention and works from a local run or written to S3 by the
deployed runner.

assemble() shapes the run into the JSON payload; render_dashboard() injects it
into the template. The same payload is what the future SPA Evals tab consumes,
so the shape is the contract.
"""

from __future__ import annotations

import json
from dataclasses import asdict

from .matrix import tag_breakdown


def assemble(meta: dict, cards, case_records, cases) -> dict:
    """Build the dashboard JSON payload.

    meta: {suite, judge, models, generated_at, git_sha, ...}
    cards: list[ModelScorecard]
    case_records: list of dicts {case_id, model, tags, prompt, response, quality,
        rationale, latency_ms, cost_usd, success, error, input_tokens, output_tokens}
    cases: the GenCase list (for the tag breakdown join)
    """
    # Recover the (case_id -> tags) join for the breakdown from the scores.
    scores = [_ScoreView(r["case_id"], r["model"], r["quality"], r["success"]) for r in case_records]
    breakdown = tag_breakdown(cases, scores)
    tags = [
        {"tag": tag, "rows": [{"model": m, "quality": q, "success": s, "n": n} for (m, q, s, n) in rows]}
        for tag, rows in breakdown.items()
    ]
    return {
        "meta": meta,
        "scorecards": [asdict(c) for c in cards],
        "tags": tags,
        "cases": case_records,
    }


class _ScoreView:
    """Minimal stand-in with the attributes tag_breakdown reads."""

    __slots__ = ("case_id", "model", "quality", "success")

    def __init__(self, case_id, model, quality, success):
        self.case_id = case_id
        self.model = model
        self.quality = quality
        self.success = success


def render_dashboard(run_data: dict, *, title: str = "Homebase Eval Dashboard") -> str:
    """Inject the payload into the template and return a self-contained HTML string."""
    payload = json.dumps(run_data, ensure_ascii=False)
    # Prevent a "</script>" inside any model response from closing the data block.
    payload = payload.replace("</", "<\\/")
    return _TEMPLATE.replace("__TITLE__", _escape(title)).replace("__DATA__", payload)


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
  :root{
    --bg:#0b0e14; --panel:#121722; --panel2:#0f141d; --line:#222b3a; --ink:#e6edf3;
    --muted:#8b98a9; --accent:#5eead4; --accent2:#7c9cff; --good:#3fb950; --bad:#f85149;
    --warn:#d29922;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
  a{color:var(--accent2)}
  .wrap{max-width:1200px;margin:0 auto;padding:28px 20px 80px}
  header h1{margin:0 0 4px;font-size:22px;letter-spacing:.2px}
  header .sub{color:var(--muted);font-size:13px}
  .meta{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 26px}
  .chip{background:var(--panel);border:1px solid var(--line);border-radius:999px;
    padding:4px 11px;font-size:12px;color:var(--muted)}
  .chip b{color:var(--ink);font-weight:600}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:860px){.grid{grid-template-columns:1fr}}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 16px 18px;min-width:0}
  .card h2{margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{color:var(--muted);font-weight:600;cursor:pointer;user-select:none}
  th.sorted::after{content:" \25B4";color:var(--accent)}
  th.sorted.desc::after{content:" \25BE"}
  td.model,th.model{white-space:normal}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--accent)}
  .bar{height:7px;border-radius:4px;background:linear-gradient(90deg,var(--accent2),var(--accent));display:inline-block;vertical-align:middle}
  .barwrap{display:inline-block;width:90px;height:7px;background:#0a0f18;border-radius:4px;margin-right:8px;vertical-align:middle}
  .full{grid-column:1/-1}
  .heat td{text-align:center;font-variant-numeric:tabular-nums;cursor:pointer;border:1px solid var(--panel2)}
  .heat td.lab{cursor:default;text-align:left;color:var(--muted)}
  .heat th{text-align:center;font-size:11px;text-transform:none;letter-spacing:0}
  .controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
  select,input[type=search]{background:var(--panel2);border:1px solid var(--line);color:var(--ink);
    border-radius:8px;padding:7px 10px;font:inherit;font-size:13px}
  .pill{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
  .pill.pass{color:var(--good);border-color:#193a24}
  .pill.fail{color:var(--bad);border-color:#3a1a1a}
  .caserow{cursor:pointer}
  .caserow:hover{background:var(--panel2)}
  .detail{background:var(--panel2)}
  .detail td{white-space:normal}
  .kv{display:grid;grid-template-columns:88px 1fr;gap:6px 14px;margin:2px 0 6px}
  .kv .k{color:var(--muted);font-size:12px}
  pre{white-space:pre-wrap;word-break:break-word;background:#0a0f18;border:1px solid var(--line);
    border-radius:8px;padding:10px;margin:4px 0;font-family:ui-monospace,Menlo,monospace;font-size:12px;max-height:280px;overflow:auto}
  .muted{color:var(--muted)}
  .q{font-variant-numeric:tabular-nums}
  svg text{fill:var(--muted);font-size:11px}
  .dot{cursor:pointer}
  .legend{color:var(--muted);font-size:12px;margin-top:8px}
  .rankn{color:var(--muted);width:22px}
  footer{margin-top:30px;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>__TITLE__</h1>
    <div class="sub" id="subtitle"></div>
  </header>
  <div class="meta" id="meta"></div>

  <div class="card full" style="margin-bottom:16px">
    <h2>Leaderboard <span class="muted" style="text-transform:none;letter-spacing:0">(click a header to sort)</span></h2>
    <table id="lb"><thead></thead><tbody></tbody></table>
  </div>

  <div class="grid" style="margin-bottom:16px">
    <div class="card">
      <h2>Capability heatmap <span class="muted" style="text-transform:none;letter-spacing:0">(quality; click a cell to filter cases)</span></h2>
      <div style="overflow:auto"><table class="heat" id="heat"></table></div>
      <div class="legend">Green is higher quality, red lower. Cell = mean judge score for that model on that capability.</div>
    </div>
    <div class="card">
      <h2>Quality vs cost</h2>
      <div id="scatter"></div>
      <div class="legend">Up and to the left is better: higher quality, lower cost per call. Point size = p50 latency.</div>
    </div>
  </div>

  <div class="card full" style="margin-bottom:16px">
    <h2>Latency by model (p50 / p95, ms)</h2>
    <div id="latency"></div>
  </div>

  <div class="card full">
    <h2>Case drill-down</h2>
    <div class="controls">
      <select id="fModel"></select>
      <select id="fTag"></select>
      <select id="fResult">
        <option value="">all results</option>
        <option value="pass">pass only</option>
        <option value="fail">fail only</option>
      </select>
      <input type="search" id="fSearch" placeholder="search prompt / response / case id">
      <span class="muted" id="caseCount"></span>
    </div>
    <table id="cases"><thead><tr>
      <th data-k="case_id">case</th><th data-k="model" class="model">model</th>
      <th data-k="quality">quality</th><th data-k="success">result</th>
      <th data-k="latency_ms">ms</th><th data-k="cost_usd">$</th>
    </tr></thead><tbody></tbody></table>
  </div>

  <footer>Generated by the Homebase eval harness. Self-contained: this file has no external dependencies.</footer>
</div>

<script type="application/json" id="data">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const $ = (s,r=document)=>r.querySelector(s);
const el = (t,a={},...kids)=>{const n=document.createElement(t);for(const k in a){if(k==='class')n.className=a[k];else if(k==='html')n.innerHTML=a[k];else n.setAttribute(k,a[k]);}for(const c of kids)n.append(c.nodeType?c:document.createTextNode(c));return n;};
const fmt=(x,d=3)=>Number(x).toFixed(d);
const pct=x=>Math.round(x*100)+'%';
const money=x=>'$'+Number(x).toFixed(5);
const shortModel=m=>m.replace(/^(us|eu|apac|global)\./,'');
function qColor(q){ // 0 red -> 1 green
  const r=Math.round(248+(63-248)*q), g=Math.round(81+(185-81)*q), b=Math.round(73+(80-73)*q);
  return `rgb(${r},${g},${b})`;
}

// ---- header + meta ----
const m=DATA.meta||{};
$('#subtitle').textContent = `suite ${m.suite||'?'} · judged by ${shortModel(m.judge||'?')} · ${(DATA.cases||[]).length} results across ${DATA.scorecards.length} models`;
const meta=$('#meta');
const chips=[['suite',m.suite],['judge',shortModel(m.judge||'')],['cases',m.n_cases],['generated',m.generated_at],['git',m.git_sha]];
for(const [k,v] of chips){ if(v) meta.append(el('span',{class:'chip',html:`${k} <b>${v}</b>`})); }

// ---- leaderboard (sortable) ----
const LBCOLS=[['','rank'],['model','model'],['avg_quality','quality'],['success_rate','success'],
  ['p50_latency_ms','p50 ms'],['p95_latency_ms','p95 ms'],['avg_cost_usd','avg $'],['total_cost_usd','total $'],['n_errors','err']];
let lbSort={k:'avg_quality',desc:true};
function renderLB(){
  const cards=[...DATA.scorecards].sort((a,b)=>{
    const k=lbSort.k; if(!k) return 0; const d=lbSort.desc?-1:1;
    return (a[k]>b[k]?1:a[k]<b[k]?-1:0)*d;
  });
  const th=$('#lb thead'); th.innerHTML='';
  const tr=el('tr');
  for(const [k,label] of LBCOLS){
    const h=el('th',{},label); if(k===lbSort.k){h.classList.add('sorted');if(lbSort.desc)h.classList.add('desc');}
    if(k) h.onclick=()=>{ if(lbSort.k===k)lbSort.desc=!lbSort.desc; else {lbSort={k,desc:true};} renderLB(); };
    if(k==='model')h.classList.add('model'); tr.append(h);
  }
  th.append(tr);
  const tb=$('#lb tbody'); tb.innerHTML='';
  cards.forEach((c,i)=>{
    const bar=el('span',{class:'barwrap'}, el('span',{class:'bar',style:`width:${Math.max(2,c.avg_quality*90)}px`}));
    tb.append(el('tr',{},
      el('td',{class:'rankn'},String(i+1)),
      el('td',{class:'model'}, el('code',{},shortModel(c.model))),
      el('td',{class:'q'}, bar, document.createTextNode(fmt(c.avg_quality))),
      el('td',{},pct(c.success_rate)),
      el('td',{},String(Math.round(c.p50_latency_ms))),
      el('td',{},String(Math.round(c.p95_latency_ms))),
      el('td',{},money(c.avg_cost_usd)),
      el('td',{},money(c.total_cost_usd)),
      el('td',{style:c.n_errors?'color:var(--bad)':''},String(c.n_errors)),
    ));
  });
}
renderLB();

// ---- heatmap ----
const models=DATA.scorecards.map(c=>c.model);
const tags=DATA.tags.map(t=>t.tag);
const heatVal={}; // tag -> model -> quality
for(const t of DATA.tags){heatVal[t.tag]={};for(const r of t.rows)heatVal[t.tag][r.model]=r.quality;}
(function renderHeat(){
  const tbl=$('#heat'); tbl.innerHTML='';
  const head=el('tr'); head.append(el('th',{},'model \\ tag'));
  for(const t of tags) head.append(el('th',{},t));
  tbl.append(head);
  for(const mo of models){
    const tr=el('tr'); tr.append(el('td',{class:'lab'}, el('code',{},shortModel(mo))));
    for(const t of tags){
      const q=heatVal[t]&&heatVal[t][mo];
      const td=el('td',{}, q==null?'·':fmt(q,2));
      if(q!=null){td.style.background=qColor(q);td.style.color= q>0.55?'#06210f':'#3a0d0d';
        td.title=`${shortModel(mo)} · ${t}: ${fmt(q,3)}`;
        td.onclick=()=>{ $('#fTag').value=t; $('#fModel').value=mo; applyCaseFilter(); document.getElementById('cases').scrollIntoView({behavior:'smooth'}); };}
      tr.append(td);
    }
    tbl.append(tr);
  }
})();

// ---- scatter: quality vs cost ----
(function renderScatter(){
  const W=460,H=260,pad=42;
  const costs=DATA.scorecards.map(c=>c.avg_cost_usd);
  const maxC=Math.max(...costs,1e-6)*1.15, maxL=Math.max(...DATA.scorecards.map(c=>c.p50_latency_ms),1);
  const x=c=>pad+(c.avg_cost_usd/maxC)*(W-pad-16);
  const y=c=>H-pad-(c.avg_quality)*(H-pad-16);
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">`;
  s+=`<line x1="${pad}" y1="${H-pad}" x2="${W-8}" y2="${H-pad}" stroke="#2a3444"/>`;
  s+=`<line x1="${pad}" y1="8" x2="${pad}" y2="${H-pad}" stroke="#2a3444"/>`;
  s+=`<text x="${(W)/2}" y="${H-8}" text-anchor="middle">avg cost per call (USD) →</text>`;
  s+=`<text x="14" y="${H/2}" text-anchor="middle" transform="rotate(-90 14 ${H/2})">quality →</text>`;
  for(let g=0;g<=1;g+=0.25){const yy=H-pad-g*(H-pad-16);s+=`<line x1="${pad}" y1="${yy}" x2="${W-8}" y2="${yy}" stroke="#161c27"/><text x="${pad-6}" y="${yy+3}" text-anchor="end">${g}</text>`;}
  DATA.scorecards.forEach(c=>{
    const r=5+ (c.p50_latency_ms/maxL)*10;
    s+=`<circle class="dot" cx="${x(c).toFixed(1)}" cy="${y(c).toFixed(1)}" r="${r.toFixed(1)}" fill="${qColor(c.avg_quality)}" fill-opacity="0.8" stroke="#0b0e14"><title>${shortModel(c.model)} — q ${fmt(c.avg_quality)}, ${money(c.avg_cost_usd)}, p50 ${Math.round(c.p50_latency_ms)}ms</title></circle>`;
    s+=`<text x="${(x(c)+r+4).toFixed(1)}" y="${(y(c)+3).toFixed(1)}" style="fill:var(--ink)">${shortModel(c.model)}</text>`;
  });
  s+=`</svg>`; $('#scatter').innerHTML=s;
})();

// ---- latency bars ----
(function renderLatency(){
  const maxL=Math.max(...DATA.scorecards.map(c=>c.p95_latency_ms),1);
  let h='';
  for(const c of DATA.scorecards){
    const p50=(c.p50_latency_ms/maxL)*100, p95=(c.p95_latency_ms/maxL)*100;
    h+=`<div style="display:flex;align-items:center;gap:10px;margin:7px 0">
      <div style="width:150px" class="muted"><code>${shortModel(c.model)}</code></div>
      <div style="flex:1;position:relative;height:16px;background:#0a0f18;border-radius:5px">
        <div title="p95 ${Math.round(c.p95_latency_ms)}ms" style="position:absolute;height:100%;width:${p95}%;background:#22314a;border-radius:5px"></div>
        <div title="p50 ${Math.round(c.p50_latency_ms)}ms" style="position:absolute;height:100%;width:${p50}%;background:linear-gradient(90deg,var(--accent2),var(--accent));border-radius:5px"></div>
      </div>
      <div style="width:150px" class="muted">p50 ${Math.round(c.p50_latency_ms)} · p95 ${Math.round(c.p95_latency_ms)}</div>
    </div>`;
  }
  $('#latency').innerHTML=h;
})();

// ---- case drill-down ----
const CASES=DATA.cases||[];
(function initFilters(){
  const fm=$('#fModel'); fm.append(el('option',{value:''},'all models'));
  for(const mo of models) fm.append(el('option',{value:mo},shortModel(mo)));
  const ft=$('#fTag'); ft.append(el('option',{value:''},'all capabilities'));
  for(const t of tags) ft.append(el('option',{value:t},t));
  ['#fModel','#fTag','#fResult'].forEach(s=>$(s).onchange=applyCaseFilter);
  $('#fSearch').oninput=applyCaseFilter;
})();
let caseSort={k:'quality',desc:false};
$('#cases thead').querySelectorAll('th').forEach(h=>{h.onclick=()=>{const k=h.dataset.k;if(caseSort.k===k)caseSort.desc=!caseSort.desc;else caseSort={k,desc:true};applyCaseFilter();};});
function applyCaseFilter(){
  const mo=$('#fModel').value, tg=$('#fTag').value, res=$('#fResult').value, q=$('#fSearch').value.toLowerCase();
  let rows=CASES.filter(c=>(!mo||c.model===mo)&&(!tg||(c.tags||[]).includes(tg))
    &&(!res||(res==='pass'?c.success:!c.success))
    &&(!q||(c.case_id+ ' '+(c.prompt||'')+' '+(c.response||'')).toLowerCase().includes(q)));
  rows.sort((a,b)=>{const k=caseSort.k,d=caseSort.desc?-1:1;return (a[k]>b[k]?1:a[k]<b[k]?-1:0)*d;});
  const tb=$('#cases tbody'); tb.innerHTML='';
  for(const c of rows){
    const tr=el('tr',{class:'caserow'},
      el('td',{}, el('code',{},c.case_id)),
      el('td',{class:'model'}, el('code',{},shortModel(c.model))),
      el('td',{class:'q',style:`color:${qColor(c.quality)}`}, fmt(c.quality)),
      el('td',{}, el('span',{class:'pill '+(c.success?'pass':'fail')}, c.success?'pass':'fail')),
      el('td',{},String(Math.round(c.latency_ms))),
      el('td',{},money(c.cost_usd)),
    );
    const detail=el('tr',{class:'detail',style:'display:none'});
    const cell=el('td',{colspan:'6'});
    cell.append(el('div',{class:'kv'},
      el('div',{class:'k'},'tags'), el('div',{},(c.tags||[]).join(', ')||'—'),
      el('div',{class:'k'},'judge'), el('div',{class:'muted'}, c.rationale||'—'),
      el('div',{class:'k'},'tokens'), el('div',{class:'muted'}, `${c.input_tokens||0} in / ${c.output_tokens||0} out`),
    ));
    cell.append(el('div',{class:'k',style:'margin-top:6px'},'prompt'));
    cell.append(el('pre',{}, c.prompt||''));
    cell.append(el('div',{class:'k'},'response'));
    cell.append(el('pre',{}, c.response|| (c.error? '[error] '+c.error : '')));
    detail.append(cell);
    tr.onclick=()=>{detail.style.display=detail.style.display==='none'?'':'none';};
    tb.append(tr); tb.append(detail);
  }
  $('#caseCount').textContent=`${rows.length} / ${CASES.length} cases`;
}
applyCaseFilter();
</script>
</body>
</html>
"""
