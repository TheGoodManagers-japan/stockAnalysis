#!/usr/bin/env node

// dashboard/scripts/optimize-weights.js
// Backtested weight optimizer for master score formula.
// Grid-searches Fund/Val/Tech weight combinations to maximize tier separation.
//
// Usage:
//   DATABASE_URL=... node scripts/optimize-weights.js
//   DATABASE_URL=... node scripts/optimize-weights.js --regime UP
//   DATABASE_URL=... node scripts/optimize-weights.js --output weights.json
//   DATABASE_URL=... node scripts/optimize-weights.js --days 30
//
// The script:
// 1. Loads historical scan_results with forward returns from price_history
// 2. Grid-searches weight combinations (sum = 1.0)
// 3. Maximizes tier separation: avg forward return of top quintile minus bottom quintile
// 4. Optionally filters by market_regime

import { query } from "../lib/db.js";
import { writeFileSync } from "fs";

// ── CLI args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

const regimeFilter = getArg("--regime"); // e.g. UP, DOWN, RANGE, STRONG_UP
const outputFile = getArg("--output"); // e.g. weights.json
const forwardDays = parseInt(getArg("--days") || "30", 10);
const STEP = 0.05; // grid step size (5%)

console.log(`\n=== Master Score Weight Optimizer ===`);
console.log(`Forward return window: ${forwardDays} days`);
if (regimeFilter) console.log(`Regime filter: ${regimeFilter}`);
console.log("");

// ── Load data ─────────────────────────────────────────────────────
async function loadData() {
  const regimeClause = regimeFilter
    ? `AND sr.market_regime = '${regimeFilter.toUpperCase()}'`
    : "";

  const sql = `
    SELECT
      sr.ticker_code,
      sr.scan_date,
      sr.fundamental_score,
      sr.valuation_score,
      sr.technical_score,
      sr.short_term_score,
      sr.long_term_score,
      sr.current_price,
      sr.stop_loss,
      sr.price_target,
      sr.market_regime,
      ph.close AS forward_close
    FROM scan_results sr
    JOIN LATERAL (
      SELECT close
      FROM price_history ph
      WHERE ph.ticker_code = sr.ticker_code
        AND ph.date > sr.scan_date
      ORDER BY ph.date ASC
      OFFSET ${forwardDays - 1} LIMIT 1
    ) ph ON true
    WHERE sr.fundamental_score IS NOT NULL
      AND sr.valuation_score IS NOT NULL
      AND sr.technical_score IS NOT NULL
      AND sr.current_price > 0
      ${regimeClause}
    ORDER BY sr.scan_date DESC
  `;

  const result = await query(sql);
  return result.rows;
}

// ── Score function ────────────────────────────────────────────────
function computeScore(row, weights) {
  const { wFund, wVal, wTech, wMom, wSent, wRR } = weights;

  const tech = Number(row.technical_score) || 0;
  const fund = Number(row.fundamental_score) || 0;
  const val = Number(row.valuation_score) || 0;

  const stScore = Number(row.short_term_score) || 0;
  const momentum = stScore >= 1 && stScore <= 7 ? ((7 - stScore) / 6) * 10 : 5;

  const ltScore = Number(row.long_term_score) || 0;
  const sentiment = ltScore >= 1 && ltScore <= 7 ? ((7 - ltScore) / 6) * 10 : 5;

  const price = Number(row.current_price) || 0;
  const stop = Number(row.stop_loss) || 0;
  const target = Number(row.price_target) || 0;
  let rrNorm = 0;
  if (price > 0 && stop > 0 && target > price) {
    const risk = Math.abs(price - stop);
    const reward = target - price;
    if (risk > 0) {
      const rr = Math.min(reward / risk, 3.0);
      rrNorm = (rr / 3.0) * 10;
    }
  }

  const raw =
    tech * wTech + fund * wFund + val * wVal +
    momentum * wMom + sentiment * wSent + rrNorm * wRR;
  const maxRaw = 10 * (wTech + wFund + wVal + wMom + wSent + wRR);
  return maxRaw > 0 ? (raw / maxRaw) * 100 : 0;
}

// ── Tier separation metric ────────────────────────────────────────
function evaluateWeights(data, weights) {
  // Score all rows
  const scored = data.map((row) => ({
    score: computeScore(row, weights),
    forwardReturn:
      (Number(row.forward_close) - Number(row.current_price)) /
      Number(row.current_price),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const n = scored.length;
  if (n < 10) return { separation: 0, topReturn: 0, bottomReturn: 0 };

  const quintileSize = Math.floor(n / 5);
  const topQuintile = scored.slice(0, quintileSize);
  const bottomQuintile = scored.slice(n - quintileSize);

  const avg = (arr) => arr.reduce((s, r) => s + r.forwardReturn, 0) / arr.length;

  const topReturn = avg(topQuintile);
  const bottomReturn = avg(bottomQuintile);
  const separation = topReturn - bottomReturn;

  return { separation, topReturn, bottomReturn };
}

// ── Grid search ───────────────────────────────────────────────────
function gridSearch(data) {
  let best = { separation: -Infinity };
  let bestWeights = null;
  let tested = 0;

  // Grid search over Fund, Val, Tech weights (they get the largest share)
  // Mom, Sent, RR get fixed smaller allocations from remaining budget
  for (let wFund = 0; wFund <= 100; wFund += STEP * 100) {
    for (let wVal = 0; wVal <= 100 - wFund; wVal += STEP * 100) {
      for (let wTech = 0; wTech <= 100 - wFund - wVal; wTech += STEP * 100) {
        const remainder = 100 - wFund - wVal - wTech;
        // Split remainder among Mom, Sent, RR in a few patterns
        const splits = [
          [remainder * 0.5, remainder * 0.25, remainder * 0.25],
          [remainder * 0.33, remainder * 0.33, remainder * 0.34],
          [remainder * 0.6, remainder * 0.2, remainder * 0.2],
          [remainder * 0.2, remainder * 0.2, remainder * 0.6],
        ];

        for (const [wMom, wSent, wRR] of splits) {
          const weights = {
            wFund: wFund,
            wVal: wVal,
            wTech: wTech,
            wMom: wMom,
            wSent: wSent,
            wRR: wRR,
          };
          const result = evaluateWeights(data, weights);
          tested++;

          if (result.separation > best.separation) {
            best = result;
            bestWeights = { ...weights };
          }
        }
      }
    }
  }

  return { bestWeights, best, tested };
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  try {
    console.log("Loading historical data...");
    const data = await loadData();
    console.log(`Loaded ${data.length} data points with ${forwardDays}-day forward returns.\n`);

    if (data.length < 50) {
      console.log("Not enough data for meaningful optimization (need >=50 rows).");
      process.exit(1);
    }

    console.log("Running grid search (this may take a moment)...");
    const { bestWeights, best, tested } = gridSearch(data);

    const total =
      bestWeights.wFund + bestWeights.wVal + bestWeights.wTech +
      bestWeights.wMom + bestWeights.wSent + bestWeights.wRR;

    console.log(`\nTested ${tested.toLocaleString()} weight combinations.\n`);
    console.log("=== Best Weights ===");
    console.log(`  Fundamental: ${((bestWeights.wFund / total) * 100).toFixed(1)}%  (raw: ${bestWeights.wFund.toFixed(1)})`);
    console.log(`  Valuation:   ${((bestWeights.wVal / total) * 100).toFixed(1)}%  (raw: ${bestWeights.wVal.toFixed(1)})`);
    console.log(`  Technical:   ${((bestWeights.wTech / total) * 100).toFixed(1)}%  (raw: ${bestWeights.wTech.toFixed(1)})`);
    console.log(`  Momentum:    ${((bestWeights.wMom / total) * 100).toFixed(1)}%  (raw: ${bestWeights.wMom.toFixed(1)})`);
    console.log(`  Sentiment:   ${((bestWeights.wSent / total) * 100).toFixed(1)}%  (raw: ${bestWeights.wSent.toFixed(1)})`);
    console.log(`  Risk/Reward: ${((bestWeights.wRR / total) * 100).toFixed(1)}%  (raw: ${bestWeights.wRR.toFixed(1)})`);
    console.log("");
    console.log("=== Performance ===");
    console.log(`  Top quintile avg ${forwardDays}d return:    ${(best.topReturn * 100).toFixed(2)}%`);
    console.log(`  Bottom quintile avg ${forwardDays}d return: ${(best.bottomReturn * 100).toFixed(2)}%`);
    console.log(`  Tier separation:                   ${(best.separation * 100).toFixed(2)}%`);
    console.log("");

    // Compare with current production weights
    const prodWeights = { wFund: 25, wVal: 30, wTech: 10, wMom: 15, wSent: 10, wRR: 10 };
    const prodResult = evaluateWeights(data, prodWeights);
    console.log("=== Current Production Weights ===");
    console.log(`  Top quintile avg ${forwardDays}d return:    ${(prodResult.topReturn * 100).toFixed(2)}%`);
    console.log(`  Bottom quintile avg ${forwardDays}d return: ${(prodResult.bottomReturn * 100).toFixed(2)}%`);
    console.log(`  Tier separation:                   ${(prodResult.separation * 100).toFixed(2)}%`);
    console.log("");

    const improvement = best.separation - prodResult.separation;
    console.log(
      improvement > 0
        ? `Optimized weights improve tier separation by ${(improvement * 100).toFixed(2)} percentage points.`
        : `Current production weights are already near-optimal.`
    );

    if (outputFile) {
      const output = {
        optimizedAt: new Date().toISOString(),
        forwardDays,
        regime: regimeFilter || "ALL",
        dataPoints: data.length,
        weights: {
          fundamental: Math.round((bestWeights.wFund / total) * 100) / 100,
          valuation: Math.round((bestWeights.wVal / total) * 100) / 100,
          technical: Math.round((bestWeights.wTech / total) * 100) / 100,
          momentum: Math.round((bestWeights.wMom / total) * 100) / 100,
          sentiment: Math.round((bestWeights.wSent / total) * 100) / 100,
          riskReward: Math.round((bestWeights.wRR / total) * 100) / 100,
        },
        performance: {
          topQuintileReturn: Math.round(best.topReturn * 10000) / 100,
          bottomQuintileReturn: Math.round(best.bottomReturn * 10000) / 100,
          tierSeparation: Math.round(best.separation * 10000) / 100,
        },
      };
      writeFileSync(outputFile, JSON.stringify(output, null, 2));
      console.log(`\nResults saved to ${outputFile}`);
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
