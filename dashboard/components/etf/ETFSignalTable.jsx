"use client";

function regimeColor(regime) {
  if (regime?.includes("UP")) return "var(--accent-green)";
  if (regime?.includes("DOWN")) return "var(--accent-red)";
  return "var(--text-muted)";
}

function triggerBadge(trigger) {
  if (!trigger) return null;
  const colors = {
    DIP: "var(--accent-green)",
    BREAKOUT: "var(--accent-blue)",
    RETEST: "var(--accent-yellow)",
    RECLAIM: "rgba(168, 85, 247, 0.9)",
    INSIDE: "var(--text-muted)",
  };
  const color = colors[trigger] || "var(--text-muted)";
  return (
    <span style={{
      fontSize: "0.7rem",
      padding: "2px 6px",
      borderRadius: "4px",
      background: `${color}20`,
      color,
      fontWeight: 600,
    }}>
      {trigger}
    </span>
  );
}

export default function ETFSignalTable({ signals = [] }) {
  if (!signals.length) {
    return (
      <div className="card">
        <p className="text-muted">No ETF signal data yet. Run a scan.</p>
      </div>
    );
  }

  const buySignals = signals.filter((s) => s.is_buy_now);
  const others = signals.filter((s) => !s.is_buy_now);

  return (
    <>
      {buySignals.length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ color: "var(--accent-green)", marginBottom: "0.75rem" }}>
            Buy Signals ({buySignals.length})
          </h3>
          <div className="table-wrapper">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-primary)" }}>
                  <th style={th}>ETF</th>
                  <th style={th}>Name</th>
                  <th style={th}>Trigger</th>
                  <th style={thR}>Price</th>
                  <th style={thR}>Stop</th>
                  <th style={thR}>Target</th>
                  <th style={thR}>R:R</th>
                  <th style={thR}>RSI</th>
                  <th style={th}>Regime</th>
                </tr>
              </thead>
              <tbody>
                {buySignals.map((s) => {
                  const details = s.details_json || {};
                  return (
                    <tr key={s.ticker_code} style={{ borderBottom: "1px solid var(--border-primary)" }}>
                      <td style={td}><strong>{s.ticker_code}</strong></td>
                      <td style={td}>{details.shortName || s.ticker_code}</td>
                      <td style={td}>{triggerBadge(s.trigger_type)}</td>
                      <td style={tdR}>{fmt(s.current_price)}</td>
                      <td style={tdR}>{fmt(s.stop_loss)}</td>
                      <td style={tdR}>{fmt(s.price_target)}</td>
                      <td style={{ ...tdR, color: Number(s.rr_ratio) >= 2 ? "var(--accent-green)" : "var(--text-secondary)" }}>
                        {s.rr_ratio ? Number(s.rr_ratio).toFixed(1) : "-"}
                      </td>
                      <td style={tdR}>{s.rsi_14 ? Number(s.rsi_14).toFixed(0) : "-"}</td>
                      <td style={{ ...td, color: regimeColor(s.market_regime) }}>{s.market_regime}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {buySignals.some((s) => s.buy_now_reason) && (
            <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {buySignals.map((s) => s.buy_now_reason ? (
                <div key={s.ticker_code} style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <strong>{s.ticker_code}:</strong> {s.buy_now_reason}
                </div>
              ) : null)}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h3 style={{ color: "var(--text-heading)", marginBottom: "0.75rem" }}>
          All ETFs ({signals.length})
        </h3>
        <div className="table-wrapper">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-primary)" }}>
                <th style={th}>ETF</th>
                <th style={th}>Name</th>
                <th style={thR}>Price</th>
                <th style={thR}>RSI</th>
                <th style={th}>Regime</th>
                <th style={th}>Signal</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => {
                const details = s.details_json || {};
                return (
                  <tr key={s.ticker_code} style={{ borderBottom: "1px solid var(--border-primary)" }}>
                    <td style={td}>
                      <strong>{s.ticker_code}</strong>
                      {s.is_buy_now && <span style={{ color: "var(--accent-green)", marginLeft: "0.3rem" }}>{"\u25CF"}</span>}
                    </td>
                    <td style={td}>{details.shortName || s.ticker_code}</td>
                    <td style={tdR}>{fmt(s.current_price)}</td>
                    <td style={tdR}>{s.rsi_14 ? Number(s.rsi_14).toFixed(0) : "-"}</td>
                    <td style={{ ...td, color: regimeColor(s.market_regime) }}>{s.market_regime}</td>
                    <td style={td}>{s.is_buy_now ? triggerBadge(s.trigger_type) : <span style={{ color: "var(--text-muted)" }}>-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const th = { textAlign: "left", padding: "0.5rem 0.5rem", color: "var(--text-muted)", fontWeight: 500, fontSize: "0.8rem" };
const thR = { ...th, textAlign: "right" };
const td = { padding: "0.5rem", verticalAlign: "middle" };
const tdR = { ...td, textAlign: "right" };

function fmt(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
