"use client";

function alertStyle(type, conviction) {
  const base = {
    borderRadius: "8px",
    padding: "0.75rem 1rem",
    marginBottom: "0.5rem",
  };
  switch (type) {
    case "rotation":
      return { ...base, background: "rgba(59, 130, 246, 0.1)", borderLeft: "3px solid var(--accent-blue)" };
    case "opportunity":
      return { ...base, background: "rgba(34, 197, 94, 0.08)", borderLeft: "3px solid var(--accent-green)" };
    case "defensive":
      return { ...base, background: "rgba(239, 68, 68, 0.1)", borderLeft: "3px solid var(--accent-red)" };
    case "focus":
      return { ...base, background: "rgba(34, 197, 94, 0.1)", borderLeft: "3px solid var(--accent-green)" };
    case "macro_warning":
      return { ...base, background: "rgba(234, 179, 8, 0.1)", borderLeft: "3px solid var(--accent-yellow)" };
    default:
      return { ...base, background: "var(--bg-tertiary)", borderLeft: "3px solid var(--text-muted)" };
  }
}

function typeLabel(type) {
  switch (type) {
    case "rotation": return "Rotation Signal";
    case "opportunity": return "Opportunity";
    case "defensive": return "Defensive";
    case "focus": return "Stay Focused";
    case "macro_warning": return "Macro Warning";
    default: return "Alert";
  }
}

function convictionBadge(conviction) {
  const color = conviction === "high" ? "var(--accent-red)" : conviction === "medium" ? "var(--accent-yellow)" : "var(--text-muted)";
  return (
    <span style={{
      fontSize: "0.7rem",
      padding: "2px 6px",
      borderRadius: "4px",
      background: `${color}20`,
      color,
      fontWeight: 600,
      textTransform: "uppercase",
    }}>
      {conviction}
    </span>
  );
}

export default function AllocationAlerts({ alerts = [] }) {
  if (!alerts.length) return null;

  return (
    <div className="card">
      <h3 style={{ color: "var(--text-heading)", marginBottom: "0.75rem" }}>Allocation Alerts</h3>
      {alerts.map((alert, i) => (
        <div key={i} style={alertStyle(alert.type, alert.conviction)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
            <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{typeLabel(alert.type)}</span>
            {convictionBadge(alert.conviction)}
          </div>
          <div style={{ fontSize: "0.9rem", marginBottom: "0.25rem" }}>{alert.message}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{alert.details}</div>
        </div>
      ))}
    </div>
  );
}
