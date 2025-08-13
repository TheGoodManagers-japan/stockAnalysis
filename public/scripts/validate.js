// validate.js

export function validateInputs(stock, historicalData) {
  const issues = [];
  const isNum = (v) => Number.isFinite(v);
  const isPos = (v) => isNum(v) && v > 0;

  if (!stock) issues.push("stock object is missing");
  if (!historicalData) issues.push("historicalData is missing");
  if (!Array.isArray(historicalData))
    issues.push("historicalData is not an array");

  const len = Array.isArray(historicalData) ? historicalData.length : 0;
  if (len < 20)
    issues.push(`historicalData too short (need ≥20 bars, got ${len})`);

  const last = len ? historicalData[len - 1] : {};
  if (!isPos(stock?.currentPrice)) issues.push("stock.currentPrice missing/≤0");
  if (!isPos(last?.close)) issues.push("lastBar.close missing/≤0");
  if (!isPos(last?.open)) issues.push("lastBar.open missing/≤0");
  if (!isPos(last?.high)) issues.push("lastBar.high missing/≤0");
  if (!isPos(last?.low)) issues.push("lastBar.low missing/≤0");
  if (!isNum(last?.volume)) issues.push("lastBar.volume missing/NaN");

  const techFields = [
    "movingAverage5d",
    "movingAverage25d",
    "movingAverage50d",
    "movingAverage75d",
    "movingAverage200d",
    "rsi14",
    "macd",
    "macdSignal",
    "stochasticK",
    "stochasticD",
    "bollingerUpper",
    "bollingerLower",
    "atr14",
    "obv",
    "fiftyTwoWeekHigh",
    "fiftyTwoWeekLow",
    "openPrice",
    "prevClosePrice",
    "highPrice",
    "lowPrice",
  ];
  const weakTechs = techFields.filter((k) => !isNum(stock?.[k]));

  if (issues.length) {
    console.warn("[swingEntry] ❌ Input validation failed:", issues);
    try {
      const snap = (b) => ({
        date: b?.date,
        open: b?.open,
        high: b?.high,
        low: b?.low,
        close: b?.close,
        volume: b?.volume,
      });
      const last3 = historicalData?.slice(Math.max(0, len - 3)).map(snap) || [];
      console.warn("[swingEntry] Last 3 candles snapshot:", last3);
    } catch {}
    if (weakTechs.length) {
      console.warn("[swingEntry] ⚠️ Non-finite technical fields:", weakTechs);
    }
    return false;
  }
  if (weakTechs.length >= 5) {
    console.warn(
      "[swingEntry] ⚠️ Many technical fields are NaN; results may be conservative:",
      weakTechs
    );
  }
  return true;
}
