// Allocation alerts — rules engine that compares global market regimes
// and suggests capital allocation shifts when JPX isn't the best market.

/**
 * @param {Array<{ticker_code: string, ticker_name: string, regime: string, region: string, ticker_type: string, momentum_score: number}>} regimeSnapshots
 * @param {{ modifier: number, label: string }} macroData
 * @returns {Array<{ type: string, message: string, conviction: string, fromMarket: string|null, toMarket: string|null, details: string }>}
 */
export function computeAllocationAlerts(regimeSnapshots, macroData) {
  if (!regimeSnapshots || !regimeSnapshots.length) return [];

  const etfs = regimeSnapshots.filter((s) => s.ticker_type === "index_etf");
  const byCode = new Map(etfs.map((s) => [s.ticker_code, s]));

  const jpx = byCode.get("EWJ");
  const spy = byCode.get("SPY");
  const qqq = byCode.get("QQQ");
  const vgk = byCode.get("VGK");
  const eem = byCode.get("EEM");
  const fxi = byCode.get("FXI");
  const ewz = byCode.get("EWZ");
  const inda = byCode.get("INDA");

  const alerts = [];
  const isUp = (r) => r?.regime === "STRONG_UP" || r?.regime === "UP";
  const isDown = (r) => r?.regime === "DOWN" || r?.regime === "STRONG_DOWN";
  const isStrongUp = (r) => r?.regime === "STRONG_UP";

  // Japan weak + US strong
  if (jpx && spy && isDown(jpx) && isUp(spy)) {
    const conviction = isStrongUp(spy) ? "high" : "medium";
    alerts.push({
      type: "rotation",
      message: "US market outperforming Japan. Consider SPY/QQQ ETF exposure.",
      conviction,
      fromMarket: "JP",
      toMarket: "US",
      details: `Japan (EWJ): ${jpx.regime} | US (SPY): ${spy.regime}. 20d returns: JP ${fmtPct(jpx.ret_20d)} vs US ${fmtPct(spy.ret_20d)}.`,
    });
  }

  // Japan weak + Europe strong
  if (jpx && vgk && isDown(jpx) && isUp(vgk)) {
    alerts.push({
      type: "rotation",
      message: "Europe outperforming Japan. VGK showing strength.",
      conviction: isStrongUp(vgk) ? "high" : "medium",
      fromMarket: "JP",
      toMarket: "EU",
      details: `Japan (EWJ): ${jpx.regime} | Europe (VGK): ${vgk.regime}. 20d: JP ${fmtPct(jpx.ret_20d)} vs EU ${fmtPct(vgk.ret_20d)}.`,
    });
  }

  // Japan weak + Emerging markets strong
  if (jpx && eem && isDown(jpx) && isUp(eem)) {
    alerts.push({
      type: "rotation",
      message: "Emerging markets accelerating while Japan stalls.",
      conviction: isStrongUp(eem) ? "high" : "medium",
      fromMarket: "JP",
      toMarket: "EM",
      details: `Japan (EWJ): ${jpx.regime} | EM (EEM): ${eem.regime}. 20d: JP ${fmtPct(jpx.ret_20d)} vs EM ${fmtPct(eem.ret_20d)}.`,
    });
  }

  // China or India breakout
  for (const [etf, label, region] of [[fxi, "China", "CN"], [inda, "India", "IN"], [ewz, "Brazil", "BR"]]) {
    if (etf && isStrongUp(etf) && jpx && !isUp(jpx)) {
      alerts.push({
        type: "opportunity",
        message: `${label} market in strong uptrend (${etf.ticker_code}).`,
        conviction: "medium",
        fromMarket: "JP",
        toMarket: region,
        details: `${label} (${etf.ticker_code}): ${etf.regime}, momentum ${Number(etf.momentum_score).toFixed(0)}. 20d return: ${fmtPct(etf.ret_20d)}.`,
      });
    }
  }

  // All markets down — defensive
  const allDown = etfs.every((e) => isDown(e) || e.regime === "RANGE");
  if (allDown && etfs.length >= 4) {
    alerts.push({
      type: "defensive",
      message: "All major markets weak or range-bound. Defensive posture — reduce exposure, raise cash.",
      conviction: "high",
      fromMarket: null,
      toMarket: null,
      details: `Regimes: ${etfs.map((e) => `${e.ticker_code}=${e.regime}`).join(", ")}.`,
    });
  }

  // Japan strongest — stay focused
  if (jpx && isStrongUp(jpx)) {
    const othersWeak = etfs.filter((e) => e.ticker_code !== "EWJ").every((e) => !isStrongUp(e));
    if (othersWeak) {
      alerts.push({
        type: "focus",
        message: "Japan is the strongest major market. Stay focused on JPX.",
        conviction: "high",
        fromMarket: null,
        toMarket: "JP",
        details: `Japan (EWJ): ${jpx.regime}, momentum ${Number(jpx.momentum_score).toFixed(0)}. No other market in STRONG_UP.`,
      });
    }
  }

  // Macro warning overlay
  if (macroData && macroData.modifier <= -0.15) {
    alerts.push({
      type: "macro_warning",
      message: `Macro headwinds for JPX: ${macroData.label}. ${macroData.factors?.map((f) => f.reason).join(". ") || ""}`,
      conviction: macroData.modifier <= -0.20 ? "high" : "medium",
      fromMarket: "JP",
      toMarket: null,
      details: `Macro modifier: ${macroData.modifier}. Factors: ${macroData.factors?.length || 0}.`,
    });
  }

  return alerts;
}

function fmtPct(v) {
  if (v == null) return "-";
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
