"use client";

function scoreBar(score, maxScore = 100, color) {
  const pct = Math.max(0, Math.min(100, (score / maxScore) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", minWidth: "80px" }}>
      <div style={{ flex: 1, height: "6px", background: "var(--bg-tertiary)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "3px" }} />
      </div>
      <span style={{ fontSize: "0.75rem", color, fontWeight: 600, minWidth: "28px", textAlign: "right" }}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

function scoreColor(score) {
  if (score >= 70) return "var(--accent-green)";
  if (score >= 50) return "var(--accent-blue)";
  if (score >= 30) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

function categoryBadge(cat) {
  const config = {
    jp_leads: { label: "JP Leads", color: "var(--accent-blue)" },
    us_leads: { label: "US Leads", color: "rgba(168, 85, 247, 0.9)" },
    both_strong: { label: "Both Strong", color: "var(--accent-green)" },
    divergence: { label: "Diverging", color: "var(--accent-yellow)" },
    neutral: { label: "Neutral", color: "var(--text-muted)" },
  };
  const c = config[cat] || config.neutral;
  return (
    <span style={{
      fontSize: "0.7rem",
      padding: "2px 6px",
      borderRadius: "4px",
      background: `${c.color}20`,
      color: c.color,
      fontWeight: 600,
    }}>
      {c.label}
    </span>
  );
}

export default function CrossMarketOverlay({ data }) {
  if (!data || !data.pairs?.length) {
    return (
      <div className="card">
        <h3 style={{ color: "var(--text-heading)", marginBottom: "0.5rem" }}>Cross-Market Sector Strength</h3>
        <p className="text-muted">No cross-market data available. Run both JP and US sector rotation scans.</p>
      </div>
    );
  }

  const { pairs, jpLeads, usLeads, bothStrong } = data;

  return (
    <div className="card">
      <h3 style={{ color: "var(--text-heading)", marginBottom: "0.75rem" }}>
        Cross-Market Sector Strength: JP vs US
      </h3>

      {/* Summary chips */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {jpLeads.length > 0 && (
          <div style={{ fontSize: "0.8rem" }}>
            <span style={{ color: "var(--accent-blue)", fontWeight: 600 }}>{jpLeads.length}</span> JP-leading
          </div>
        )}
        {usLeads.length > 0 && (
          <div style={{ fontSize: "0.8rem" }}>
            <span style={{ color: "rgba(168, 85, 247, 0.9)", fontWeight: 600 }}>{usLeads.length}</span> US-leading
          </div>
        )}
        {bothStrong.length > 0 && (
          <div style={{ fontSize: "0.8rem" }}>
            <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>{bothStrong.length}</span> both strong
          </div>
        )}
      </div>

      {/* Comparison table */}
      <div className="table-wrapper">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-primary)" }}>
              <th style={th}>JP Sector</th>
              <th style={th}>JP Score</th>
              <th style={th}>US Sector</th>
              <th style={th}>US Score</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={p.jpSector} style={{ borderBottom: "1px solid var(--border-primary)" }}>
                <td style={td}>{p.jpSectorLabel}</td>
                <td style={td}>{scoreBar(p.jpScore, 100, scoreColor(p.jpScore))}</td>
                <td style={td}>{p.usSectorLabel}</td>
                <td style={td}>{scoreBar(p.usScore, 100, scoreColor(p.usScore))}</td>
                <td style={td}>{categoryBadge(p.category)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "0.5rem", color: "var(--text-muted)", fontWeight: 500, fontSize: "0.8rem" };
const td = { padding: "0.5rem", verticalAlign: "middle" };
