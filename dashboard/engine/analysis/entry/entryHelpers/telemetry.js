// entryHelpers/telemetry.js — telemetry, tracing, and diagnostics

/* ============== lightweight global bus for guard histos ============== */
export const teleGlobal = { histos: { headroom: [], distMA25: [] } };

/* ============================ Telemetry ============================ */
export function teleInit() {
  return {
    context: {},
    gates: {
      structure: { pass: false, why: "" },
      regime: { pass: true, why: "" },
      liquidity: { pass: undefined, why: "" },
      tapeReading: { pass: true, why: "", details: {} },
    },
    dip: { trigger: false, waitReason: "", why: "", diagnostics: {} },
    rr: {
      checked: false,
      acceptable: false,
      ratio: NaN,
      need: NaN,
      risk: NaN,
      reward: NaN,
      stop: NaN,
      target: NaN,
      probation: false,
    },
    guard: { checked: false, veto: false, reason: "", details: {} },
    outcome: { buyNow: false, reason: "" },
    reasons: [],
    trace: [],
    blocks: [],
    histos: {
      rrShortfall: [],
      headroom: [],
      distMA25: [],
    },
    distros: {
      dipV20ratio: [],
      dipBodyPct: [],
      dipRangePctATR: [],
      dipCloseDeltaATR: [],
      dipPullbackPct: [],
      dipPullbackATR: [],
      dipRecoveryPct: [],
      rsiSample: [],
    },
  };
}

export function pushBlock(tele, code, gate, why, ctx = {}) {
  tele.blocks.push({ code, gate, why, ctx });
}

/* ============================ Tracing ============================ */
export function mkTracer(opts = {}) {
  const level = opts.debugLevel || "normal";
  const logs = [];
  const should = (lvl) =>
    level !== "off" && (level === "verbose" || lvl !== "debug");
  const emit = (e) => {
    logs.push(e);
    try {
      opts.onTrace?.(e);
    } catch {}
  };
  const T = (module, step, ok, msg, ctx = {}, lvl = "info") => {
    if (!should(lvl)) return;
    emit({
      ts: Date.now(),
      module,
      step,
      ok: !!ok,
      msg: String(msg || ""),
      ctx,
    });
  };
  T.logs = logs;
  return T;
}

/* ============================ Telemetry Helpers ============================ */
export function toTeleRR(rr) {
  return {
    checked: true,
    acceptable: !!rr.acceptable,
    ratio: rr.ratio,
    need: rr.need,
    risk: rr.risk,
    reward: rr.reward,
    stop: rr.stop,
    target: rr.target,
    probation: !!rr.probation,
    horizonClamped: !!rr.horizonClamped,
    scootBlocked: !!rr.scootBlocked,
    scootBlockReason: rr.scootBlockReason || "",
  };
}

export function summarizeTelemetryForLog(tele) {
  try {
    const g = tele?.gates || {};
    const rr = tele?.rr || {};
    const guard = tele?.guard || {};
    return {
      gates: {
        regime: { pass: true, why: "" },
        liquidity: { pass: g.liquidity?.pass, why: g.liquidity?.why },
        structure: { pass: g.structure?.pass, why: g.structure?.why },
        tapeReading: { pass: g.tapeReading?.pass, why: g.tapeReading?.why },
      },
      rr: {
        checked: rr.checked,
        acceptable: rr.acceptable,
        ratio: rr.ratio,
        need: rr.need,
        stop: rr.stop,
        target: rr.target,
        probation: rr.probation,
        horizonClamped: rr.horizonClamped,
      },
      guard: {
        checked: guard.checked,
        veto: guard.veto,
        reason: guard.reason,
        details: guard.details,
      },
      context: tele?.context,
      blocks: tele?.blocks,
      histos: tele?.histos,
      distros: tele?.distros,
    };
  } catch {
    return {};
  }
}

export function summarizeBlocks(teleList = []) {
  const out = {};
  for (const t of teleList) {
    for (const b of t.blocks || []) {
      const key = `${b.code}`;
      if (!out[key]) out[key] = { count: 0, examples: [], ctxSample: [] };
      out[key].count++;
      if (out[key].examples.length < 6) {
        out[key].examples.push(
          `${t?.context?.ticker || "UNK"}` +
            (t?.context?.gatesDataset?.lastDate
              ? `@${t.context.gatesDataset.lastDate}`
              : "")
        );
      }
      if (out[key].ctxSample.length < 3) out[key].ctxSample.push(b.ctx);
    }
  }
  return Object.entries(out)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([code, v]) => ({
      code,
      count: v.count,
      examples: v.examples,
      ctxSample: v.ctxSample,
    }));
}

export function packLiquidity(tele, cfg) {
  const g = tele?.gates?.liquidity || {};
  const thresholds = {
    minADVNotional: cfg?.minADVNotional ?? null,
    minAvgVolume: cfg?.minAvgVolume ?? null,
    minClosePrice: cfg?.minClosePrice ?? null,
    minATRTicks: cfg?.minATRTicks ?? null,
  };
  const m = g.metrics || tele?.context?.liquidity || null;
  const ratios = m
    ? {
        advR: thresholds.minADVNotional
          ? m.adv / thresholds.minADVNotional
          : null,
        volR: thresholds.minAvgVolume
          ? m.avVol / thresholds.minAvgVolume
          : null,
        pxR: thresholds.minClosePrice ? m.px / thresholds.minClosePrice : null,
        atrTicksR: thresholds.minATRTicks
          ? m.atrTicks / thresholds.minATRTicks
          : null,
      }
    : null;

  let severity =
    g.pass === false ? "fail" : typeof g.pass === "boolean" ? "pass" : "unk";

  let warnKeys = [];
  const nearMargin = Number.isFinite(tele?.context?.liqNearMargin)
    ? tele.context.liqNearMargin
    : 0.15;
  if (g.pass && ratios) {
    const checks = [
      ["adv", ratios.advR],
      ["vol", ratios.volR],
      ["px", ratios.pxR],
      ["atrTicks", ratios.atrTicksR],
    ].filter(([, r]) => r !== null && Number.isFinite(r));
    for (const [k, r] of checks) {
      if (r <= 1 + nearMargin) warnKeys.push(k);
    }
    if (warnKeys.length) severity = "warn";
  }

  const why =
    g.why ||
    (severity === "warn" ? `near threshold: ${warnKeys.join(", ")}` : "");
  return { pass: !!g.pass, severity, why, metrics: m, thresholds, ratios };
}
