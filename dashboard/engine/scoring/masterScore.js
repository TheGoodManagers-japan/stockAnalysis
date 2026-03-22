// dashboard/engine/scoring/masterScore.js
// Unified master score (0-100) combining all scoring dimensions.
// Weights tuned for swing trading: technicals + RR matter most.

/**
 * Compute a unified master score from all scoring dimensions.
 * Formula: (Tech*25 + Fund*15 + Val*15 + Momentum*15 + Sentiment*10 + RR*20) / 10
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

  // Weighted composite: max = 10*25 + 10*15 + 10*15 + 10*15 + 10*10 + 10*20 = 1000
  const raw =
    tech * 25 + fund * 15 + val * 15 + momentum * 15 + sentiment * 10 + rrNorm * 20;

  return Math.round(raw / 10);
}
