"use client";

import {
  formatNum,
  gradeColor,
  gradeBg,
  classificationLabel,
  classificationColor,
  classificationBg,
  valuationColor,
  pillarColor,
} from "../../lib/uiHelpers";

function fmt(v, suffix = "") {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  return `${Number(v).toFixed(1)}${suffix}`;
}

export default function ValuePlayDetail({ data, scan }) {
  const pillars = data.pillars || {};
  const metrics = data.metrics || {};
  const entry = data.entry || {};
  const exit = data.exit || {};

  const grade = data.grade || scan?.value_play_grade || "?";
  const classification = data.classification || scan?.value_play_class;
  const score = Number(data.valuePlayScore || scan?.value_play_score || 0);

  return (
    <>
      {/* Overview: Grade + Classification + Score + Pillars */}
      <div className="card mb-lg">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>Value Play Overview</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{
              background: gradeBg(grade),
              color: gradeColor(grade),
              padding: "4px 14px",
              borderRadius: "var(--radius-sm)",
              fontWeight: 700,
              fontSize: "1rem",
            }}>
              Grade {grade}
            </span>
            {classification && (
              <span style={{
                background: classificationBg(classification),
                color: classificationColor(classification),
                border: `1px solid ${classificationColor(classification)}`,
                padding: "4px 12px",
                borderRadius: "9999px",
                fontSize: "0.82rem",
                fontWeight: 600,
              }}>
                {classificationLabel(classification)}
              </span>
            )}
          </div>
        </div>

        {/* Score bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", minWidth: 40 }}>Score</span>
          <div style={{ flex: 1, height: 10, background: "var(--bg-tertiary)", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(score, 100)}%`, height: "100%", background: gradeColor(grade), borderRadius: 5, transition: "width 0.4s ease" }} />
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "1rem", color: gradeColor(grade) }}>{score}/100</span>
        </div>

        {/* Pillar scores - 4 columns */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { key: "intrinsicValue", label: "Intrinsic Value" },
            { key: "quality", label: "Quality" },
            { key: "safetyMargin", label: "Safety Margin" },
            { key: "catalyst", label: "Catalyst" },
          ].map(({ key, label }) => {
            const val = pillars[key] || 0;
            return (
              <div key={key} style={{ padding: 12, background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", textAlign: "center" }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: pillarColor(val) }}>{val}</div>
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>/25</div>
                <div style={{ height: 4, background: "var(--bg-primary)", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
                  <div style={{ width: `${(val / 25) * 100}%`, height: "100%", background: pillarColor(val), borderRadius: 2 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Thesis & Strategy (2-column) */}
      <div className="grid-2 mb-lg">
        {/* Left: Investment Thesis */}
        <div className="card">
          <div className="card-title mb-md">Investment Thesis</div>
          {data.thesis && (
            <div style={{ fontSize: "0.9rem", color: "var(--text-primary)", lineHeight: 1.6, marginBottom: 16 }}>
              {data.thesis}
            </div>
          )}
          {data.catalyst && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Catalyst</div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>{data.catalyst}</div>
            </div>
          )}
          {data.risks && data.risks.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Risks</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {data.risks.map((r, i) => (
                  <span key={i} style={{
                    fontSize: "0.78rem",
                    padding: "3px 10px",
                    borderRadius: 6,
                    background: "rgba(239, 68, 68, 0.1)",
                    color: "var(--accent-red)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                  }}>{r}</span>
                ))}
              </div>
            </div>
          )}
          {data.timeHorizon && (
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Time Horizon</div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{data.timeHorizon}</div>
            </div>
          )}
        </div>

        {/* Right: Entry & Exit Strategy */}
        <div className="card">
          <div className="card-title mb-md">Entry & Exit Strategy</div>
          {entry.approach && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Approach</div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-primary)", lineHeight: 1.5 }}>{entry.approach}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
            {entry.conviction && (
              <div>
                <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Conviction</div>
                <span style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: "0.82rem",
                  background: entry.conviction === "HIGH" ? "rgba(34, 197, 94, 0.15)" : entry.conviction === "MEDIUM" ? "rgba(59, 130, 246, 0.15)" : "rgba(234, 179, 8, 0.15)",
                  color: entry.conviction === "HIGH" ? "var(--accent-green)" : entry.conviction === "MEDIUM" ? "var(--accent-blue)" : "var(--accent-yellow)",
                }}>{entry.conviction}</span>
              </div>
            )}
            {entry.timeHorizonDays && (
              <div>
                <div style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Horizon</div>
                <span style={{ fontSize: "0.85rem", color: "var(--text-primary)" }}>{entry.timeHorizonDays} days</span>
              </div>
            )}
          </div>
          {/* Price levels */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, padding: 12, background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", marginBottom: 12 }}>
            {entry.accumulationZone && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Accumulation</div>
                <div className="text-mono" style={{ fontWeight: 700, color: "var(--accent-blue)" }}>
                  {Array.isArray(entry.accumulationZone)
                    ? `${formatNum(entry.accumulationZone[0])} - ${formatNum(entry.accumulationZone[1])}`
                    : formatNum(entry.accumulationZone)}
                </div>
              </div>
            )}
            {entry.targetPrice != null && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Target</div>
                <div className="text-mono" style={{ fontWeight: 700, color: "var(--accent-green)" }}>{formatNum(entry.targetPrice)}</div>
              </div>
            )}
            {entry.stopPrice != null && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Stop</div>
                <div className="text-mono" style={{ fontWeight: 700, color: "var(--accent-red)" }}>{formatNum(entry.stopPrice)}</div>
              </div>
            )}
          </div>
          {/* Exit triggers */}
          {exit.triggers && exit.triggers.length > 0 && (
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Exit Triggers</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {exit.triggers.map((t, i) => (
                  <div key={i} style={{
                    fontSize: "0.82rem",
                    padding: "6px 10px",
                    background: "var(--bg-tertiary)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-secondary)",
                    borderLeft: "2px solid var(--accent-red)",
                  }}>{t}</div>
                ))}
              </div>
            </div>
          )}
          {exit.reviewPeriod && (
            <div style={{ marginTop: 10, fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Review: {exit.reviewPeriod}
            </div>
          )}
        </div>
      </div>

      {/* Valuation Metrics Grid */}
      <div className="card mb-lg">
        <div className="card-title mb-md">Valuation Metrics</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
          {[
            { key: "earningsYield", label: "Earnings Yield", suffix: "%" },
            { key: "peRatio", label: "P/E Ratio", suffix: "x", metric: "pe" },
            { key: "pbRatio", label: "P/B Ratio", suffix: "x", metric: "pb" },
            { key: "ptbv", label: "P/TBV", suffix: "x", metric: "pb" },
            { key: "evToEbitda", label: "EV/EBITDA", suffix: "x", metric: "evEbitda" },
            { key: "fcfYield", label: "FCF Yield", suffix: "%" },
            { key: "dividendYield", label: "Div Yield", suffix: "%" },
            { key: "dividendGrowth5yr", label: "Div Growth 5yr", suffix: "%" },
            { key: "shareholderYield", label: "Shareholder Yield", suffix: "%" },
            { key: "debtEquity", label: "D/E Ratio", suffix: "x", metric: "de" },
            { key: "impliedROE", label: "Implied ROE", suffix: "%" },
            { key: "netCashRatio", label: "Net Cash Ratio", suffix: "%" },
            { key: "grahamNumber", label: "Graham Number", suffix: "" },
            { key: "grahamDiscount", label: "Graham Discount", suffix: "%" },
          ].map(({ key, label, suffix, metric }) => (
            <div key={key} style={{ textAlign: "center", padding: "10px 8px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)" }}>
              <div style={{ fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
              <div className="text-mono" style={{
                fontSize: "0.95rem",
                fontWeight: 700,
                color: valuationColor(metrics[key], metric),
              }}>
                {fmt(metrics[key], suffix)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
