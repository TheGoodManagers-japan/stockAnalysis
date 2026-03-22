// dashboard/engine/scoring/percentileRanking.js
// Post-processing: compute percentile ranks across the scan universe.

/**
 * Compute percentile ranks for an array of scored stock results.
 * Mutates each stock object in place, adding pctile fields.
 * @param {Object[]} results - Array of scored stock objects
 */
export function computePercentiles(results) {
  if (!results || results.length === 0) return;

  const rankField = (arr, key, pctileKey) => {
    const valid = arr.filter((s) => Number.isFinite(s[key]));
    if (valid.length === 0) return;
    valid.sort((a, b) => a[key] - b[key]);
    const n = valid.length;
    valid.forEach((s, i) => {
      s[pctileKey] = n > 1 ? Math.round((i / (n - 1)) * 100) : 50;
    });
    // Stocks with no value get null
    arr
      .filter((s) => !Number.isFinite(s[key]))
      .forEach((s) => {
        s[pctileKey] = null;
      });
  };

  rankField(results, "fundamentalScore", "fundamentalScorePctile");
  rankField(results, "valuationScore", "valuationScorePctile");
  rankField(results, "technicalScore", "technicalScorePctile");
}
