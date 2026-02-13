// /scripts/branch-scorer.js
import { weekly_branches, daily_branches } from "./branches_scores.js";

// -- helpers to discretize values into your token schema --
const num = (v) => (Number.isFinite(+v) ? +v : null);
const inRange = (x, lo, hi, openHi = false) =>
  x == null ? false : openHi ? x >= lo && x < hi : x >= lo && x <= hi;

function bin_vsMA25(v) {
  if (v == null) return null;
  if (v < -5) return "vs25:-inf--5"; // not used in rules, but safe
  if (v < 0) return "vs25:-5-0";
  if (v < 5) return "vs25:0-5";
  if (v < 10) return "vs25:5-10";
  return "vs25:10-";
}

function bin_rsi(v) {
  if (v == null) return null;
  if (v < 50) return "rsi:0-50"; // fallback
  if (v < 60) return "rsi:50-60";
  if (v < 70) return "rsi:60-70";
  return "rsi:70-";
}

function bin_headroomPct(v) {
  if (v == null) return null;
  if (v < 0.6) return "hdrm:0-0.6";
  if (v < 1.0) return "hdrm:0.6-1";
  if (v < 1.5) return "hdrm:1-1.5";
  if (v < 2.5) return "hdrm:1.5-2.5";
  return "hdrm:2.5-";
}

function bin_distMA25_ATR(v) {
  if (v == null) return null;
  if (v < 0) return "d25:-0-1"; // your rules use "-0-1" to mean 0–1 below MA25 in ATRs
  if (v < 1) return "d25:1-2".replace("1-2", "-0-1"); // keep your exact tokens
  if (v < 2) return "d25:1-2";
  if (v < 3) return "d25:2-3";
  return "d25:3-";
}

function bin_liquidityJPY(turnover) {
  if (turnover == null) return null;
  if (turnover < 1e8) return "liq:0-100000000"; // fallback
  if (turnover < 5e8) return "liq:100000000-500000000";
  if (turnover < 1e9) return "liq:500000000-1000000000";
  if (turnover < 3e9) return "liq:1000000000-3000000000";
  return "liq:3000000000-";
}

function bin_volumeHeat(z) {
  if (z == null) return null;
  // conservative: HOT if clearly > 1σ
  return z >= 1 ? "vol:HOT" : "vol:COLD";
}

function bin_crossAgeDaily(barsAgo) {
  if (barsAgo == null) return null;
  if (barsAgo < 2) return "ageD:0-2";
  if (barsAgo < 4) return "ageD:2-4";
  if (barsAgo < 6) return "ageD:4-6";
  return "ageD:6+";
}

function bin_crossAgeWeekly(weeksAgo) {
  if (weeksAgo == null) return null;
  if (weeksAgo < 1) return "ageW:0-1";
  if (weeksAgo < 2) return "ageW:1-2";
  if (weeksAgo < 4) return "ageW:2-4";
  return "ageW:4+";
}

// Build a compact token bag for one event
function tokensForEvent(ev) {
  const sel = ev?.signal?.crossMeta?.selected || "NONE";
  const rsi = num(ev?.indicators?.rsi14);
  const vs25 = num(ev?.indicators?.pxVsMA?.vsMA25Pct);
  const volZ = num(ev?.indicators?.vol?.z20);
  const turnover = num(ev?.indicators?.turnoverJPY);

  const headroomPct = num(ev?.signal?.guard?.details?.headroomPct);
  const distMA25_ATR = num(ev?.signal?.guard?.details?.distFromMA25_ATR);

  const dBarsAgo = num(ev?.signal?.crossMeta?.daysSinceDailyFlip);
  const wWeeksAgo = num(ev?.signal?.crossMeta?.weeksSinceWeeklyFlip);

  const t = new Set();

  if (sel === "WEEKLY") t.add("cross_selected=WEEKLY");
  else if (sel === "DAILY") t.add("cross_selected=DAILY");
  else t.add("cross_selected=NONE");

  const rsiB = bin_rsi(rsi);
  if (rsiB) t.add(`rsi_bin=${rsiB}`);
  const vsB = bin_vsMA25(vs25);
  if (vsB) t.add(`vsMA25_bin=${vsB}`);
  const volB = bin_volumeHeat(volZ);
  if (volB) t.add(`volume_hot_bin=${volB}`);
  const liqB = bin_liquidityJPY(turnover);
  if (liqB) t.add(`liquidity_bin=${liqB}`);

  const hdrmB = bin_headroomPct(headroomPct);
  if (hdrmB) t.add(`guard_headroom_bin=${hdrmB}`);
  const d25B = bin_distMA25_ATR(distMA25_ATR);
  if (d25B) t.add(`guard_distMA25_bin=${d25B}`);

  const dAgeB = bin_crossAgeDaily(dBarsAgo);
  if (dAgeB) t.add(`cross_age_active_bin=ageD:${dAgeB.split(":")[1]}`);

  const wAgeB = bin_crossAgeWeekly(wWeeksAgo);
  if (wAgeB) t.add(`cross_age_active_bin=ageW:${wAgeB.split(":")[1]}`);

  return t;
}

// simple exact-token rule match
function matchScore(tokens, ruleStr) {
  // ruleStr example: "cross_selected=WEEKLY & guard_distMA25_bin=d25:1-2 & rsi_bin=rsi:60-70"
  const req = ruleStr
    .split("&")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const r of req) {
    if (!tokens.has(r)) return 0;
  }
  return 1;
}

export async function attachBranchScores(out) {
  if (!out || !Array.isArray(out.events)) return out;

  const weeklyRules = weekly_branches || [];
  const dailyRules = daily_branches || [];

  const totals = Object.create(null);

  for (const ev of out.events) {
    const tokens = tokensForEvent(ev);

    let best = { branch: null, score: 0 };

    // choose rules set by selected lane
    const sel = ev?.signal?.crossMeta?.selected || "NONE";
    const rules =
      sel === "WEEKLY" ? weeklyRules : sel === "DAILY" ? dailyRules : [];

    for (const r of rules) {
      if (!r?.branch) continue;
      if (matchScore(tokens, r.branch)) {
        const sc = Number(r.score) || 0;
        if (sc > best.score) best = { branch: r.branch, score: sc };
      }
    }

    // write onto the event
    ev.branch = best.branch || null;
    ev.branchScore = best.score || 0;

    if (ev.branchScore > 0) {
      totals[ev.branch] = (totals[ev.branch] || 0) + ev.branchScore;
    }
  }

  out.raw = out.raw || {};
  out.raw.branchTotals = totals;
  return out;
}
