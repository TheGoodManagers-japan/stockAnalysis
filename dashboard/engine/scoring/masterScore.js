// dashboard/engine/scoring/masterScore.js
// Unified master score (0-100) combining all scoring dimensions.
// Weights tuned for swing trading: technicals + RR + catalyst matter most.

/**
 * Compute a unified master score from all scoring dimensions.
 * Formula: (Tech*22 + Fund*14 + Val*14 + Momentum*12 + Sentiment*8 + RR*18 + Catalyst*12) / 10
 *
 * @param {Object} stock - Stock object with all scores computed
 * @returns {number} - Master score 0-100
 */
export function computeMasterScore(stock) {
  const f = (v) => (Number.isFinite(v) ? v : 0);

  const tech = f(stock.technicalScore); // 0-10
  const fund = f(stock.fundamentalScore); // 0-10
  const val = f(stock.valuationScore); // 0-10

  // Momentum: derived from short-term sentiment (1=most bullish, 7=most bearish)
  // Normalize: invert so higher = better → 0-10
  const stScore = f(stock.shortTermScore);
  const momentum =
    stScore >= 1 && stScore <= 7 ? ((7 - stScore) / 6) * 10 : 5;

  // Sentiment: derived from long-term sentiment, same normalization
  const ltScore = f(stock.longTermScore);
  const sentiment =
    ltScore >= 1 && ltScore <= 7 ? ((7 - ltScore) / 6) * 10 : 5;

  // Risk/Reward: capped at 5.0, normalized to 0-10
  const price = f(stock.currentPrice);
  const stop = f(stock.stopLoss);
  const target = f(stock.priceTarget);
  let rrNorm = 0;
  if (price > 0 && stop > 0 && target > price) {
    const risk = Math.abs(price - stop);
    const reward = target - price;
    if (risk > 0) {
      const rr = Math.min(reward / risk, 5.0);
      rrNorm = (rr / 5.0) * 10;
    }
  }

  // Catalyst: news sentiment + disclosure events (0-10), defaults to 5 if no data
  const catalyst = f(stock.catalystScore) || 5;

  // Weighted composite: max = 10*(22+14+14+12+8+18+12) = 1000
  const raw =
    tech * 22 + fund * 14 + val * 14 + momentum * 12 +
    sentiment * 8 + rrNorm * 18 + catalyst * 12;

  return Math.round(raw / 10);
}
