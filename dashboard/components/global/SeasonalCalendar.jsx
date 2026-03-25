"use client";

function biasColor(bias) {
  switch (bias) {
    case "bullish": return "var(--accent-green)";
    case "bearish": return "var(--accent-red)";
    case "volatile": return "var(--accent-yellow)";
    case "cautious": return "var(--accent-yellow)";
    default: return "var(--text-muted)";
  }
}

function biasIcon(bias) {
  switch (bias) {
    case "bullish": return "\u2191";
    case "bearish": return "\u2193";
    case "volatile": return "\u26A1";
    case "cautious": return "\u26A0";
    default: return "\u2022";
  }
}

function bankBadge(bank) {
  const colors = {
    BOJ: "var(--accent-red)",
    Fed: "var(--accent-blue)",
  };
  const color = colors[bank] || "var(--text-muted)";
  return (
    <span style={{
      fontSize: "0.7rem",
      padding: "2px 6px",
      borderRadius: "4px",
      background: `${color}20`,
      color,
      fontWeight: 600,
    }}>
      {bank}
    </span>
  );
}

export default function SeasonalCalendar({ data }) {
  if (!data) return null;

  const { activeEvents, upcomingEvents, upcomingMeetings, overallBias } = data;
  const hasContent = activeEvents?.length > 0 || upcomingEvents?.length > 0 || upcomingMeetings?.length > 0;

  if (!hasContent) return null;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h3 style={{ color: "var(--text-heading)", margin: 0 }}>Seasonal Calendar</h3>
        {overallBias !== "neutral" && (
          <span style={{
            fontSize: "0.8rem",
            padding: "3px 8px",
            borderRadius: "4px",
            background: `${biasColor(overallBias)}15`,
            color: biasColor(overallBias),
            fontWeight: 600,
          }}>
            {overallBias.charAt(0).toUpperCase() + overallBias.slice(1)} bias
          </span>
        )}
      </div>

      {/* Active events */}
      {activeEvents?.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Active Now
          </div>
          {activeEvents.map((e) => (
            <div
              key={e.id}
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                background: `${biasColor(e.bias)}10`,
                borderLeft: `3px solid ${biasColor(e.bias)}`,
                marginBottom: "0.35rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.15rem" }}>
                <span style={{ color: biasColor(e.bias) }}>{biasIcon(e.bias)}</span>
                <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{e.name}</span>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>({e.market})</span>
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{e.description}</div>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming events */}
      {upcomingEvents?.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Coming Soon (14 days)
          </div>
          {upcomingEvents.map((e) => (
            <div
              key={e.id}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "6px",
                background: "var(--bg-tertiary)",
                marginBottom: "0.25rem",
                fontSize: "0.85rem",
              }}
            >
              <span style={{ color: biasColor(e.bias), marginRight: "0.3rem" }}>{biasIcon(e.bias)}</span>
              <strong>{e.name}</strong>
              <span style={{ color: "var(--text-muted)", marginLeft: "0.3rem" }}>({e.market})</span>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming central bank meetings */}
      {upcomingMeetings?.length > 0 && (
        <div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Central Bank Meetings (7 days)
          </div>
          {upcomingMeetings.map((m, i) => (
            <div
              key={i}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "6px",
                background: "var(--bg-tertiary)",
                marginBottom: "0.25rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.85rem",
              }}
            >
              {bankBadge(m.bank)}
              <span>{new Date(m.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                {m.type === "fomc" ? "FOMC" : "Policy Meeting"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
