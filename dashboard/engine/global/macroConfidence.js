// Macro-to-JPX confidence modifier.
// Given macro regime data (VIX, USDJPY, DXY, TNX, oil), computes an adjustment
// factor (-0.3 to +0.3) that reflects how favorable macro conditions are for JPX.

/**
 * @param {Array<{tickerCode: string, regime: string, ret5: number, ret20: number, momentumScore: number}>} macroResults
 * @returns {{ modifier: number, label: string, factors: Array<{name: string, impact: number, reason: string}> }}
 */
export function computeMacroConfidenceModifier(macroResults) {
  if (!macroResults || !macroResults.length) {
    return { modifier: 0, label: "Unknown", factors: [] };
  }

  const byCode = new Map(macroResults.map((r) => [r.tickerCode, r]));
  const factors = [];
  let modifier = 0;

  // VIX: rising = risk-off (bad for JPX), falling = risk-on (good)
  const vix = byCode.get("^VIX");
  if (vix) {
    if (vix.regime === "STRONG_UP" || vix.regime === "UP") {
      const impact = vix.regime === "STRONG_UP" ? -0.15 : -0.08;
      modifier += impact;
      factors.push({ name: "VIX", impact, reason: `VIX trending up (${vix.regime}) — risk-off environment` });
    } else if (vix.regime === "DOWN" || vix.regime === "STRONG_DOWN") {
      const impact = vix.regime === "STRONG_DOWN" ? 0.10 : 0.05;
      modifier += impact;
      factors.push({ name: "VIX", impact, reason: `VIX trending down (${vix.regime}) — risk-on, favorable` });
    }
  }

  // USD/JPY: rising = yen weakening (good for JPX exporters), falling = yen strengthening (headwind)
  const usdjpy = byCode.get("USDJPY=X");
  if (usdjpy) {
    if (usdjpy.regime === "DOWN" || usdjpy.regime === "STRONG_DOWN") {
      // Yen strengthening — headwind for JPX
      const impact = usdjpy.regime === "STRONG_DOWN" ? -0.15 : -0.08;
      modifier += impact;
      factors.push({ name: "USD/JPY", impact, reason: `Yen strengthening (${usdjpy.regime}) — JPX headwind` });
    } else if (usdjpy.regime === "STRONG_UP" || usdjpy.regime === "UP") {
      // Yen weakening — tailwind for JPX exporters
      const impact = usdjpy.regime === "STRONG_UP" ? 0.10 : 0.05;
      modifier += impact;
      factors.push({ name: "USD/JPY", impact, reason: `Yen weakening (${usdjpy.regime}) — JPX tailwind for exporters` });
    }
  }

  // DXY (Dollar Index): rising dollar + rising yields = pressure on non-US markets
  const dxy = byCode.get("DX-Y.NYB");
  const tnx = byCode.get("^TNX");
  if (dxy && tnx) {
    const dxyRising = dxy.regime === "STRONG_UP" || dxy.regime === "UP";
    const tnxRising = tnx.regime === "STRONG_UP" || tnx.regime === "UP";
    if (dxyRising && tnxRising) {
      modifier -= 0.08;
      factors.push({ name: "DXY + Yields", impact: -0.08, reason: "Strong dollar + rising yields — global tightening pressure" });
    } else if (!dxyRising && !tnxRising) {
      modifier += 0.05;
      factors.push({ name: "DXY + Yields", impact: 0.05, reason: "Weak dollar + stable/falling yields — easing pressure" });
    }
  }

  // Oil: falling oil = input cost relief for JP manufacturing
  const oil = byCode.get("CL=F");
  if (oil) {
    if (oil.regime === "DOWN" || oil.regime === "STRONG_DOWN") {
      modifier += 0.05;
      factors.push({ name: "Oil", impact: 0.05, reason: `Oil falling (${oil.regime}) — input cost relief for JP manufacturing` });
    } else if (oil.regime === "STRONG_UP") {
      modifier -= 0.05;
      factors.push({ name: "Oil", impact: -0.05, reason: `Oil surging (${oil.regime}) — cost pressure on JP importers` });
    }
  }

  // Clamp to [-0.3, +0.3]
  modifier = Math.max(-0.3, Math.min(0.3, +modifier.toFixed(3)));

  // Label
  let label;
  if (modifier >= 0.10) label = "Favorable";
  else if (modifier >= 0.03) label = "Slightly Favorable";
  else if (modifier <= -0.10) label = "Cautious";
  else if (modifier <= -0.03) label = "Slightly Cautious";
  else label = "Neutral";

  return { modifier, label, factors };
}
