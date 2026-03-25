"use client";

function regimeColor(regime) {
  switch (regime) {
    case "STRONG_UP": return "var(--accent-green)";
    case "UP": return "rgba(34, 197, 94, 0.6)";
    case "RANGE": return "var(--text-muted)";
    case "DOWN": return "rgba(239, 68, 68, 0.6)";
    case "STRONG_DOWN": return "var(--accent-red)";
    default: return "var(--text-muted)";
  }
}

function regimeBg(regime) {
  switch (regime) {
    case "STRONG_UP": return "rgba(34, 197, 94, 0.15)";
    case "UP": return "rgba(34, 197, 94, 0.08)";
    case "RANGE": return "var(--bg-tertiary)";
    case "DOWN": return "rgba(239, 68, 68, 0.08)";
    case "STRONG_DOWN": return "rgba(239, 68, 68, 0.15)";
    default: return "var(--bg-tertiary)";
  }
}

function regimeArrow(regime) {
  if (regime?.includes("UP")) return "\u2191";
  if (regime?.includes("DOWN")) return "\u2193";
  return "\u2192";
}

function formatPct(v) {
  if (v == null) return "-";
  const n = Number(v);
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function pctColor(v) {
  if (v == null) return "var(--text-muted)";
  return Number(v) >= 0 ? "var(--accent-green)" : "var(--accent-red)";
}

export default function MarketThermometer({ snapshots = [] }) {
  const etfs = snapshots.filter((s) => s.ticker_type === "index_etf");

  if (!etfs.length) {
    return (
      <div className="card">
        <h3 style={{ color: "var(--text-heading)", marginBottom: "0.5rem" }}>Market Thermometer</h3>
        <p className="text-muted">No data yet. Run a global regime scan.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ color: "var(--text-heading)", marginBottom: "1rem" }}>Market Thermometer</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.75rem" }}>
        {etfs.map((s) => (
          <div
            key={s.ticker_code}
            style={{
              background: regimeBg(s.regime),
              border: `1px solid ${regimeColor(s.regime)}40`,
              borderRadius: "8px",
              padding: "0.75rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
              <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{s.ticker_code}</span>
              <span style={{ color: regimeColor(s.regime), fontWeight: 600, fontSize: "0.85rem" }}>
                {regimeArrow(s.regime)} {s.regime?.replace("_", " ")}
              </span>
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.35rem" }}>
              {s.ticker_name}
            </div>
            <div style={{ fontSize: "0.85rem", marginBottom: "0.25rem" }}>
              {Number(s.current_price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
            <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.8rem" }}>
              <span>
                5d: <span style={{ color: pctColor(s.ret_5d) }}>{formatPct(s.ret_5d)}</span>
              </span>
              <span>
                20d: <span style={{ color: pctColor(s.ret_20d) }}>{formatPct(s.ret_20d)}</span>
              </span>
            </div>
            <div style={{ marginTop: "0.35rem" }}>
              <div
                style={{
                  height: "4px",
                  background: "var(--bg-secondary)",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, Number(s.momentum_score) || 50))}%`,
                    background: regimeColor(s.regime),
                    borderRadius: "2px",
                    transition: "width 0.3s",
                  }}
                />
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "2px" }}>
                Momentum: {Number(s.momentum_score)?.toFixed(0) || "-"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
