/**
 * buildSectorRotationDashboardBubbleEmbed.js
 *
 * Takes the output of analyzeSectorRotation(...) and returns a single self-contained
 * HTML/CSS/JS snippet you can paste into a Bubble HTML element.
 *
 * Returns:
 *   { bubbleHtmlCode }
 *
 * Notes:
 * - Fully self-contained (no external libs).
 * - Uses <script type="application/json"> to safely embed the data.
 * - Click a sector card to open a detail modal.
 */

export function buildSectorRotationDashboardBubbleEmbed(
  sectorRotationResult,
  {
    containerId = `sr-${Math.random().toString(16).slice(2)}`,
    title = "JP Sector Rotation (Swing Dashboard)",
    showExplainPanel = true,
    defaultView = "cards", // "cards" | "table"
  } = {},
) {
  const dataJson = safeJsonForScriptTag(sectorRotationResult);

  const bubbleHtmlCode = `
<div id="${containerId}" class="sr-wrap">
  <div class="sr-header">
    <div class="sr-title">
      <div class="sr-h1">${escapeHtml(title)}</div>
      <div class="sr-sub" data-sr-asof></div>
    </div>
    <div class="sr-controls">
      <div class="sr-control">
        <label>Search</label>
        <input type="text" data-sr-search placeholder="e.g., Tech, Banks, Autos..." />
      </div>
      <div class="sr-control">
        <label>View</label>
        <select data-sr-view>
          <option value="cards"${defaultView === "cards" ? " selected" : ""}>Heatmap Cards</option>
          <option value="table"${defaultView === "table" ? " selected" : ""}>Leaderboard Table</option>
        </select>
      </div>
      <div class="sr-control">
        <label>Filter</label>
        <select data-sr-filter>
          <option value="all" selected>All</option>
          <option value="recommended">Recommended (>= 70)</option>
          <option value="avoid">Avoid (<= 35)</option>
          <option value="shifts">Shifts (Accel & Score)</option>
        </select>
      </div>
      <div class="sr-control">
        <label>Sort</label>
        <select data-sr-sort>
          <option value="score" selected>Score</option>
          <option value="accelSwing">Accel (RS5 - RS20)</option>
          <option value="rs10">RS10</option>
          <option value="rs5">RS5</option>
          <option value="breadth20">Breadth20</option>
        </select>
      </div>
      <div class="sr-control">
        <label>Rows</label>
        <select data-sr-limit>
          <option value="8">8</option>
          <option value="12" selected>12</option>
          <option value="20">20</option>
          <option value="999">All</option>
        </select>
      </div>
    </div>
  </div>

  ${
    showExplainPanel
      ? `
  <div class="sr-explain">
    <div class="sr-pill">Weighted Bellwethers</div>
    <div class="sr-pill">Swing Lookbacks: 5 / 10 / 20</div>
    <div class="sr-pill">Accel: RS5 − RS20</div>
    <div class="sr-pill">Breadth (Participation)</div>
    <div class="sr-note">
      <b>How to read:</b> Higher <b>Score</b> = stronger rotation vs benchmark.
      <b>Accel</b> highlights sectors improving <i>right now</i>.
      <b>Breadth</b> is equal-weight participation (soldiers joining the general).
    </div>
  </div>
`
      : ""
  }

  <div class="sr-panels">
    <div class="sr-panel sr-summary">
      <div class="sr-panel-title">Summary</div>
      <div class="sr-kv">
        <div class="sr-k">Benchmark</div><div class="sr-v" data-sr-bench></div>
        <div class="sr-k">Top Sector</div><div class="sr-v" data-sr-top></div>
        <div class="sr-k">Counts</div><div class="sr-v" data-sr-counts></div>
      </div>
      <div class="sr-shifts">
        <div class="sr-panel-title">Shifts (Accelerating)</div>
        <div class="sr-shifts-list" data-sr-shifts></div>
      </div>
    </div>

    <div class="sr-panel sr-main">
      <div class="sr-panel-title">Heatmap</div>
      <div class="sr-cards" data-sr-cards></div>

      <div class="sr-table-wrap" data-sr-table-wrap style="display:none;">
        <table class="sr-table" data-sr-table></table>
      </div>
    </div>
  </div>

  <div class="sr-modal" data-sr-modal style="display:none;">
    <div class="sr-modal-backdrop" data-sr-modal-close></div>
    <div class="sr-modal-card">
      <div class="sr-modal-head">
        <div>
          <div class="sr-modal-title" data-sr-modal-title></div>
          <div class="sr-modal-sub" data-sr-modal-sub></div>
        </div>
        <button class="sr-btn" data-sr-modal-close>&times;</button>
      </div>
      <div class="sr-modal-body" data-sr-modal-body></div>
    </div>
  </div>
</div>

<style>
  .sr-wrap{
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji","Segoe UI Emoji";
    color:#111827;
    background:#ffffff;
    border:1px solid #e5e7eb;
    border-radius:14px;
    padding:14px;
    box-sizing:border-box;
  }
  .sr-header{display:flex; gap:14px; justify-content:space-between; align-items:flex-start; flex-wrap:wrap;}
  .sr-title{min-width:260px;}
  .sr-h1{font-size:18px; font-weight:800; letter-spacing:-0.02em;}
  .sr-sub{font-size:12px; color:#6b7280; margin-top:2px;}
  .sr-controls{display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;}
  .sr-control{display:flex; flex-direction:column; gap:4px;}
  .sr-control label{font-size:11px; color:#6b7280;}
  .sr-control input,.sr-control select{
    font-size:13px; padding:8px 10px; border:1px solid #e5e7eb; border-radius:10px; outline:none;
    background:#fff; min-width:160px;
  }
  .sr-control input:focus,.sr-control select:focus{border-color:#c7d2fe; box-shadow:0 0 0 3px rgba(99,102,241,0.12);}

  .sr-explain{
    margin-top:12px;
    display:flex; gap:8px; flex-wrap:wrap; align-items:center;
    background:#f9fafb; border:1px solid #e5e7eb; border-radius:12px; padding:10px;
  }
  .sr-pill{
    font-size:11px; padding:6px 10px; border-radius:999px;
    background:#ffffff; border:1px solid #e5e7eb; color:#111827; font-weight:700;
  }
  .sr-note{font-size:12px; color:#374151; margin-left:auto; min-width:260px;}
  .sr-note b{color:#111827;}

  .sr-panels{display:grid; grid-template-columns: 320px 1fr; gap:12px; margin-top:12px;}
  @media (max-width: 980px){ .sr-panels{grid-template-columns: 1fr;} }

  .sr-panel{
    background:#ffffff; border:1px solid #e5e7eb; border-radius:14px; padding:12px;
  }
  .sr-panel-title{font-size:12px; font-weight:800; color:#111827; margin-bottom:10px;}
  .sr-kv{display:grid; grid-template-columns: 110px 1fr; gap:8px 10px; font-size:13px;}
  .sr-k{color:#6b7280;}
  .sr-v{color:#111827; font-weight:700;}

  .sr-shifts{margin-top:12px;}
  .sr-shifts-list{display:flex; flex-direction:column; gap:8px;}
  .sr-shift-item{
    display:flex; justify-content:space-between; align-items:center; gap:10px;
    padding:10px; border:1px solid #e5e7eb; border-radius:12px; background:#f9fafb;
  }
  .sr-shift-left{display:flex; flex-direction:column; gap:2px;}
  .sr-shift-sector{font-weight:900;}
  .sr-shift-meta{font-size:12px; color:#6b7280;}
  .sr-badge{
    font-size:11px; font-weight:900; padding:6px 10px; border-radius:999px;
    border:1px solid #e5e7eb; background:#fff; color:#111827; white-space:nowrap;
  }

  .sr-cards{
    display:grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap:10px;
  }
  @media (max-width: 1100px){ .sr-cards{grid-template-columns: repeat(2, minmax(0, 1fr));} }
  @media (max-width: 720px){ .sr-cards{grid-template-columns: 1fr;} }

  .sr-card{
    border:1px solid #e5e7eb;
    border-radius:14px;
    padding:12px;
    background:#fff;
    cursor:pointer;
    transition: transform .08s ease, box-shadow .08s ease, border-color .08s ease;
  }
  .sr-card:hover{transform: translateY(-1px); border-color:#c7d2fe; box-shadow:0 8px 20px rgba(17,24,39,0.08);}
  .sr-card-top{display:flex; justify-content:space-between; align-items:flex-start; gap:10px;}
  .sr-sector{font-size:14px; font-weight:900; letter-spacing:-0.01em;}
  .sr-momentum{font-size:11px; font-weight:900; padding:6px 10px; border-radius:999px; border:1px solid #e5e7eb; background:#fff;}
  .sr-card-mid{margin-top:10px; display:flex; gap:10px; align-items:center; justify-content:space-between;}
  .sr-score{
    font-size:28px; font-weight:1000; letter-spacing:-0.04em;
  }
  .sr-mini{
    display:flex; flex-direction:column; gap:4px; align-items:flex-end;
    font-size:12px; color:#374151;
  }
  .sr-mini b{color:#111827;}
  .sr-bar{
    width:120px; height:8px; border-radius:999px; background:#e5e7eb; overflow:hidden; border:1px solid #e5e7eb;
  }
  .sr-bar > div{height:100%; width:50%; background:#111827;}
  .sr-card-bot{margin-top:10px; display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;}
  .sr-leaders{display:flex; gap:6px; flex-wrap:wrap; align-items:center;}
  .sr-chip{
    font-size:11px; font-weight:900; padding:6px 8px; border-radius:999px; border:1px solid #e5e7eb; background:#fff; color:#111827;
  }
  .sr-muted{font-size:12px; color:#6b7280;}

  .sr-table{width:100%; border-collapse:separate; border-spacing:0; overflow:hidden; border:1px solid #e5e7eb; border-radius:12px;}
  .sr-table th,.sr-table td{padding:10px 10px; font-size:13px; border-bottom:1px solid #e5e7eb; text-align:left;}
  .sr-table th{font-size:11px; color:#6b7280; background:#f9fafb; font-weight:900; letter-spacing:0.02em; text-transform:uppercase;}
  .sr-table tr:last-child td{border-bottom:none;}
  .sr-row-score{font-weight:1000;}

  .sr-btn{
    width:34px; height:34px; border-radius:10px; border:1px solid #e5e7eb; background:#fff;
    font-size:20px; line-height:1; cursor:pointer;
  }
  .sr-btn:hover{border-color:#c7d2fe; box-shadow:0 0 0 3px rgba(99,102,241,0.10);}

  .sr-modal{position:fixed; inset:0; z-index:9999;}
  .sr-modal-backdrop{position:absolute; inset:0; background:rgba(17,24,39,0.55);}
  .sr-modal-card{
    position:absolute; left:50%; top:50%;
    transform:translate(-50%,-50%);
    width:min(820px, calc(100vw - 24px));
    max-height: min(80vh, 720px);
    overflow:auto;
    background:#fff; border-radius:16px; border:1px solid #e5e7eb;
    box-shadow:0 20px 60px rgba(17,24,39,0.25);
  }
  .sr-modal-head{display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:14px; border-bottom:1px solid #e5e7eb;}
  .sr-modal-title{font-size:16px; font-weight:1000;}
  .sr-modal-sub{font-size:12px; color:#6b7280; margin-top:2px;}
  .sr-modal-body{padding:14px;}
  .sr-grid{display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:10px;}
  @media (max-width: 820px){ .sr-grid{grid-template-columns: 1fr;} }
  .sr-metric{border:1px solid #e5e7eb; border-radius:14px; padding:12px; background:#f9fafb;}
  .sr-metric .k{font-size:11px; color:#6b7280; font-weight:900; text-transform:uppercase; letter-spacing:0.02em;}
  .sr-metric .v{font-size:18px; font-weight:1000; margin-top:6px;}
  .sr-metric .h{font-size:12px; color:#374151; margin-top:6px;}
</style>

<script type="application/json" id="${containerId}__data">${dataJson}</script>
<script>
(function(){
  const root = document.getElementById(${JSON.stringify(containerId)});
  if (!root) return;

  // Parse embedded data
  const dataEl = document.getElementById(${JSON.stringify(containerId + "__data")});
  let data = null;
  try { data = JSON.parse(dataEl.textContent || "{}"); } catch(e){ data = null; }
  if (!data) {
    root.innerHTML = '<div style="padding:10px;color:#b91c1c;font-weight:800;">Sector data missing or invalid JSON.</div>';
    return;
  }

  // Elements
  const elAsOf = root.querySelector("[data-sr-asof]");
  const elBench = root.querySelector("[data-sr-bench]");
  const elTop = root.querySelector("[data-sr-top]");
  const elCounts = root.querySelector("[data-sr-counts]");
  const elShifts = root.querySelector("[data-sr-shifts]");
  const elCards = root.querySelector("[data-sr-cards]");
  const elTableWrap = root.querySelector("[data-sr-table-wrap]");
  const elTable = root.querySelector("[data-sr-table]");
  const inpSearch = root.querySelector("[data-sr-search]");
  const selView = root.querySelector("[data-sr-view]");
  const selFilter = root.querySelector("[data-sr-filter]");
  const selSort = root.querySelector("[data-sr-sort]");
  const selLimit = root.querySelector("[data-sr-limit]");

  const modal = root.querySelector("[data-sr-modal]");
  const modalTitle = root.querySelector("[data-sr-modal-title]");
  const modalSub = root.querySelector("[data-sr-modal-sub]");
  const modalBody = root.querySelector("[data-sr-modal-body]");
  root.querySelectorAll("[data-sr-modal-close]").forEach(btn => {
    btn.addEventListener("click", () => { modal.style.display = "none"; });
  });

  // Utilities
  const fmtPct = (x) => (x === null || x === undefined || !isFinite(x)) ? "—" : ((x*100).toFixed(1) + "%");
  const fmtNum = (x, d=2) => (x === null || x === undefined || !isFinite(x)) ? "—" : Number(x).toFixed(d);
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

  function scoreBg(score){
    // score: 0..100 -> subtle background tint via HSL
    // low = warm-ish, high = cool-ish
    const s = clamp(score, 0, 100);
    const hue = 12 + (s/100)*210; // 12..222
    const sat = 70;
    const light = 96 - (s/100)*10; // 96..86
    return "hsl(" + hue + " " + sat + "% " + light + "%)";
  }
  function barFg(score){
    const s = clamp(score, 0, 100);
    const hue = 12 + (s/100)*210;
    const sat = 70;
    const light = 35;
    return "hsl(" + hue + " " + sat + "% " + light + "%)";
  }

  function textIncludes(hay, needle){
    if (!needle) return true;
    return String(hay || "").toLowerCase().includes(String(needle).toLowerCase());
  }

  // Base data sets
  const ranked = Array.isArray(data.ranked) ? data.ranked : [];
  const heatmap = Array.isArray(data.heatmap) ? data.heatmap : [];
  const shifts = Array.isArray(data.shifts) ? data.shifts : [];
  const summary = data.summary || {};

  // Summary panel
  if (elAsOf) elAsOf.textContent = data.asOf ? ("As of " + new Date(data.asOf).toLocaleString()) : "";
  if (elBench && summary.benchmark) {
    elBench.textContent = summary.benchmark.ticker + " | 5D " + fmtPct(summary.benchmark.ret5) + " | 10D " + fmtPct(summary.benchmark.ret10) + " | 20D " + fmtPct(summary.benchmark.ret20);
  }
  if (elTop && summary.topSector) {
    elTop.textContent = summary.topSector.sector.replace(/_/g," ") + " | Score " + Math.round(summary.topSector.score) + " | Accel " + fmtPct(summary.topSector.accelSwing);
  }
  if (elCounts && summary.counts) {
    elCounts.textContent = "Sectors " + (summary.counts.sectors||0) + " | Recommended " + (summary.counts.recommended||0) + " | Avoid " + (summary.counts.avoid||0);
  }

  function renderShifts(){
    if (!elShifts) return;
    elShifts.innerHTML = "";
    if (!shifts.length) {
      elShifts.innerHTML = '<div class="sr-muted">No accelerating shifts detected.</div>';
      return;
    }
    shifts.slice(0,6).forEach(s => {
      const div = document.createElement("div");
      div.className = "sr-shift-item";
      div.innerHTML = \`
        <div class="sr-shift-left">
          <div class="sr-shift-sector">\${escapeHtmlLocal(s.sector.replace(/_/g," "))}</div>
          <div class="sr-shift-meta">Score \${Math.round(s.score)} • Accel \${fmtPct(s.accelSwing)} • RS5 \${fmtPct(s.rs5)} • RS20 \${fmtPct(s.rs20)}</div>
        </div>
        <div class="sr-badge">Shift</div>
      \`;
      elShifts.appendChild(div);
    });
  }

  function currentDataset(){
    const filter = (selFilter && selFilter.value) || "all";
    const search = (inpSearch && inpSearch.value) || "";
    const limit = Number((selLimit && selLimit.value) || 12);

    let arr = heatmap.map(h => {
      // join with ranked metrics if present
      const r = ranked.find(x => x.sector === h.id) || {};
      return { ...h, __ranked: r };
    });

    // Filters
    if (filter === "recommended") arr = arr.filter(x => (x.score||0) >= 70);
    if (filter === "avoid") arr = arr.filter(x => (x.score||0) <= 35);
    if (filter === "shifts") {
      const shiftSet = new Set(shifts.map(s => s.sector));
      arr = arr.filter(x => shiftSet.has(x.id));
    }

    // Search
    if (search.trim()) {
      arr = arr.filter(x =>
        textIncludes(x.label, search) ||
        textIncludes(x.id, search) ||
        (x.leaders||[]).some(l => textIncludes(l.ticker, search) || textIncludes(l.name, search))
      );
    }

    // Sort
    const sortKey = (selSort && selSort.value) || "score";
    arr.sort((a,b)=>{
      const ar = a.__ranked || {};
      const br = b.__ranked || {};
      const va =
        sortKey === "score" ? (a.score||0) :
        sortKey === "accelSwing" ? (ar.accelSwing||0) :
        sortKey === "rs10" ? (ar.rs10||0) :
        sortKey === "rs5" ? (ar.rs5||0) :
        sortKey === "breadth20" ? (a.participation||0) :
        (a.score||0);

      const vb =
        sortKey === "score" ? (b.score||0) :
        sortKey === "accelSwing" ? (br.accelSwing||0) :
        sortKey === "rs10" ? (br.rs10||0) :
        sortKey === "rs5" ? (br.rs5||0) :
        sortKey === "breadth20" ? (b.participation||0) :
        (b.score||0);

      return (vb - va);
    });

    return arr.slice(0, isFinite(limit) ? limit : 12);
  }

  function openModal(item){
    const r = item.__ranked || {};
    modalTitle.textContent = item.label || item.id;
    modalSub.textContent =
      "Score " + Math.round(item.score||0) +
      " • " + (item.momentum||"") +
      " • " + (item.bellwetherHealth||"") +
      " • Breadth20 " + fmtPct(item.participation||0);

    const leaders = Array.isArray(item.leaders) ? item.leaders : [];
    const leaderHtml = leaders.length
      ? leaders.map(l => '<div class="sr-chip">' + escapeHtmlLocal((l.ticker||"") + (l.name ? (" · " + l.name) : "")) + '</div>').join("")
      : '<div class="sr-muted">No leaders available.</div>';

    modalBody.innerHTML = \`
      <div class="sr-grid">
        <div class="sr-metric">
          <div class="k">Score</div>
          <div class="v">\${Math.round(item.score||0)}</div>
          <div class="h">Composite: momentum + accel + participation + slope + regime</div>
        </div>
        <div class="sr-metric">
          <div class="k">Accel (RS5 - RS20)</div>
          <div class="v">\${fmtPct(r.accelSwing)}</div>
          <div class="h">Positive suggests rotation is strengthening now</div>
        </div>
        <div class="sr-metric">
          <div class="k">Breadth20 (EW)</div>
          <div class="v">\${fmtPct(item.participation)}</div>
          <div class="h">Participation: are the “soldiers” joining?</div>
        </div>
      </div>

      <div style="margin-top:12px" class="sr-grid">
        <div class="sr-metric">
          <div class="k">RS5</div>
          <div class="v">\${fmtPct(r.rs5)}</div>
          <div class="h">Sector 5D return vs benchmark 5D return</div>
        </div>
        <div class="sr-metric">
          <div class="k">RS10</div>
          <div class="v">\${fmtPct(r.rs10)}</div>
          <div class="h">Sector 10D return vs benchmark 10D return</div>
        </div>
        <div class="sr-metric">
          <div class="k">RS20</div>
          <div class="v">\${fmtPct(r.rs20)}</div>
          <div class="h">Sector 20D return vs benchmark 20D return</div>
        </div>
      </div>

      <div style="margin-top:14px;">
        <div class="sr-panel-title">Top Leaders (Relative Strength)</div>
        <div class="sr-leaders">\${leaderHtml}</div>
      </div>

      <div style="margin-top:14px;">
        <div class="sr-panel-title">Quick Read</div>
        <div class="sr-muted">
          <b>\${escapeHtmlLocal(item.bellwetherHealth||"")}</b> — \${(item.bellwetherHealth==="Top-Heavy")
            ? "leaders are pulling the sector; watch for weak participation / divergence."
            : "strength is broad-based; often more durable for swings."}
        </div>
      </div>
    \`;

    modal.style.display = "block";
  }

  function renderCards(){
    const items = currentDataset();
    elCards.innerHTML = "";
    items.forEach(item => {
      const r = item.__ranked || {};
      const card = document.createElement("div");
      card.className = "sr-card";
      card.style.background = scoreBg(item.score||0);

      const leaders = Array.isArray(item.leaders) ? item.leaders : [];
      const leaderChips = leaders.slice(0,3).map(l => {
        const t = (l.ticker||"") + (l.name ? (" · " + l.name) : "");
        return '<span class="sr-chip">' + escapeHtmlLocal(t) + '</span>';
      }).join("");

      const breadth = clamp((item.participation||0)*100, 0, 100);

      card.innerHTML = \`
        <div class="sr-card-top">
          <div>
            <div class="sr-sector">\${escapeHtmlLocal(item.label||item.id)}</div>
            <div class="sr-muted">\${escapeHtmlLocal(item.bellwetherHealth||"")}</div>
          </div>
          <div class="sr-momentum">\${escapeHtmlLocal(item.momentum||"")}</div>
        </div>

        <div class="sr-card-mid">
          <div class="sr-score">\${Math.round(item.score||0)}</div>
          <div class="sr-mini">
            <div><b>Accel</b> \${fmtPct(r.accelSwing)}</div>
            <div class="sr-bar" title="Breadth20 (Equal-weight participation)">
              <div style="width:\${breadth}%; background:\${barFg(item.score||0)}"></div>
            </div>
            <div><b>Breadth20</b> \${fmtPct(item.participation)}</div>
          </div>
        </div>

        <div class="sr-card-bot">
          <div class="sr-leaders">\${leaderChips || '<span class="sr-muted">No leaders</span>'}</div>
          <div class="sr-muted">RS10 \${fmtPct(r.rs10)}</div>
        </div>
      \`;

      card.addEventListener("click", ()=>openModal(item));
      elCards.appendChild(card);
    });

    if (!items.length) {
      elCards.innerHTML = '<div class="sr-muted">No results for this filter/search.</div>';
    }
  }

  function renderTable(){
    const items = currentDataset();
    elTable.innerHTML = "";

    const thead = document.createElement("thead");
    thead.innerHTML = \`
      <tr>
        <th>#</th>
        <th>Sector</th>
        <th>Score</th>
        <th>Accel</th>
        <th>RS5</th>
        <th>RS10</th>
        <th>RS20</th>
        <th>Breadth20</th>
        <th>Leaders</th>
      </tr>
    \`;
    elTable.appendChild(thead);

    const tbody = document.createElement("tbody");
    items.forEach((item, idx) => {
      const r = item.__ranked || {};
      const leaders = Array.isArray(item.leaders) ? item.leaders : [];
      const leaderStr = leaders.slice(0,3).map(l => l.ticker).filter(Boolean).join(", ");

      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.innerHTML = \`
        <td>\${idx+1}</td>
        <td><b>\${escapeHtmlLocal(item.label||item.id)}</b><div class="sr-muted">\${escapeHtmlLocal(item.bellwetherHealth||"")}</div></td>
        <td class="sr-row-score">\${Math.round(item.score||0)}</td>
        <td>\${fmtPct(r.accelSwing)}</td>
        <td>\${fmtPct(r.rs5)}</td>
        <td>\${fmtPct(r.rs10)}</td>
        <td>\${fmtPct(r.rs20)}</td>
        <td>\${fmtPct(item.participation)}</td>
        <td>\${escapeHtmlLocal(leaderStr || "—")}</td>
      \`;
      tr.addEventListener("click", ()=>openModal(item));
      tbody.appendChild(tr);
    });

    elTable.appendChild(tbody);

    if (!items.length) {
      elTable.innerHTML = '<tr><td style="padding:12px;color:#6b7280;">No results for this filter/search.</td></tr>';
    }
  }

  function setView(v){
    if (v === "table") {
      elCards.style.display = "none";
      elTableWrap.style.display = "block";
    } else {
      elCards.style.display = "grid";
      elTableWrap.style.display = "none";
    }
  }

  function render(){
    renderShifts();
    const v = (selView && selView.value) || "cards";
    setView(v);
    if (v === "table") renderTable();
    else renderCards();
  }

  // Wire events
  ["keyup","change"].forEach(evt => {
    if (inpSearch) inpSearch.addEventListener(evt, render);
  });
  [selView, selFilter, selSort, selLimit].forEach(el => {
    if (!el) return;
    el.addEventListener("change", render);
  });

  // Initial render
  render();

  // Local escapers (avoid depending on outer scope)
  function escapeHtmlLocal(str){
    return String(str||"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }
})();
</script>
`.trim();

  return { bubbleHtmlCode };
}

// ------------------------------
// Internal helpers (outside HTML string)
// ------------------------------
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Safely embeds JSON inside a <script type="application/json"> tag.
 * Avoids closing the script tag by escaping "</script" sequences.
 */
function safeJsonForScriptTag(obj) {
  const json = JSON.stringify(obj ?? {}, null, 0);
  return json.replace(/<\\/ / g, "<\\\\/"); // prevents </script> termination
}

/* ------------------------------
Example usage:

import { analyzeSectorRotation } from "./sectorRotationJP";
import { buildSectorRotationDashboardBubbleEmbed } from "./buildSectorRotationDashboardBubbleEmbed";

const res = await analyzeSectorRotation({ /* your settings */ /* });
const { bubbleHtmlCode } = buildSectorRotationDashboardBubbleEmbed(res, {
  title: "Sector Rotation — Japan",
  defaultView: "cards",
});

// bubbleHtmlCode is what you paste into a Bubble HTML element
------------------------------ */
