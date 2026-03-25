"use client";

function regimeColor(regime) {
  if (regime?.includes("UP")) return "var(--accent-green)";
  if (regime?.includes("DOWN")) return "var(--accent-red)";
  return "var(--text-muted)";
}

function regimeArrow(regime) {
  if (regime?.includes("STRONG_UP")) return "\u2191\u2191";
  if (regime?.includes("UP")) return "\u2191";
  if (regime?.includes("STRONG_DOWN")) return "\u2193\u2193";
  if (regime?.includes("DOWN")) return "\u2193";
  return "\u2192";
}

const MACRO_LABELS = {
  "USDJPY=X": { name: "USD/JPY", desc: "Yen strength" },
  "^VIX": { name: "VIX", desc: "Fear index" },
  "^TNX": { name: "US 10Y", desc: "Bond yields" },
  "DX-Y.NYB": { name: "DXY", desc: "Dollar strength" },
  "CL=F": { name: "Oil (WTI)", desc: "Energy costs" },
};

function confidenceColor(label) {
  if (label === "Favorable" || label === "Slightly Favorable") return "var(--accent-green)";
  if (label === "Cautious" || label === "Slightly Cautious") return "var(--accent-red)";
  return "var(--text-muted)";
}

export default function MacroPanel({ snapshots = [], macro = null }) {
  const macros = snapshots.filter((s) => s.ticker_type !== "index_etf");

  if (!macros.length) {
    return (
      <div className="card">
        <h3 style={{ color: "var(--text-heading)", marginBottom: "0.5rem" }}>Macro Indicators</h3>
        <p className="text-muted">No macro data yet.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ color: "var(--text-heading)", marginBottom: "1rem" }}>Macro Indicators</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        {macros.map((s) => {
          const label = MACRO_LABELS[s.ticker_code] || { name: s.ticker_name, desc: "" };
          return (
            <div
              key={s.ticker_code}
              style={{
                background: "var(--bg-tertiary)",
                borderRadius: "8px",
                padding: "0.75rem",
                borderLeft: `3px solid ${regimeColor(s.regime)}`,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.15rem" }}>
                {label.name}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                {label.desc}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                  {Number(s.current_price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span style={{ color: regimeColor(s.regime), fontSize: "0.9rem", fontWeight: 600 }}>
                  {regimeArrow(s.regime)}
                </span>
              </div>
              <div style={{ fontSize: "0.75rem", color: regimeColor(s.regime), marginTop: "0.15rem" }}>
                {s.regime?.replace("_", " ")}
              </div>
            </div>
          );
        })}
      </div>

      {/* JPX Macro Confidence */}
      {macro && (
        <div
          style={{
            background: "var(--bg-secondary)",
            borderRadius: "8px",
            padding: "1rem",
            border: `1px solid ${confidenceColor(macro.label)}30`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>JPX Macro Confidence:</span>
            <span style={{ fontWeight: 700, color: confidenceColor(macro.label), fontSize: "1rem" }}>
              {macro.label} ({macro.modifier >= 0 ? "+" : ""}{macro.modifier})
            </span>
          </div>
          {macro.factors?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {macro.factors.map((f, i) => (
                <div key={i} style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <span style={{ color: f.impact >= 0 ? "var(--accent-green)" : "var(--accent-red)", fontWeight: 600, marginRight: "0.5rem" }}>
                    {f.impact >= 0 ? "+" : ""}{f.impact.toFixed(2)}
                  </span>
                  {f.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
