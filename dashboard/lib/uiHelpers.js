// Shared UI formatting helpers used across scanner components

export const VERDICT_CONFIG = {
  CONFIRMED: {
    label: "CONFIRMED",
    icon: "\u2705",
    bg: "rgba(16, 185, 129, 0.15)",
    color: "#10b981",
    border: "#10b981",
  },
  CAUTION: {
    label: "CAUTION",
    icon: "\u26A0\uFE0F",
    bg: "rgba(245, 158, 11, 0.15)",
    color: "#f59e0b",
    border: "#f59e0b",
  },
  AVOID: {
    label: "AVOID",
    icon: "\u274C",
    bg: "rgba(239, 68, 68, 0.15)",
    color: "#ef4444",
    border: "#ef4444",
  },
};

export function formatNum(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString();
}

export function formatSector(s) {
  if (!s) return "-";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function scoreColor(v) {
  if (v == null) return "var(--text-muted)";
  const n = Number(v);
  if (n >= 7) return "var(--accent-green)";
  if (n >= 4) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

export function confidenceColor(c) {
  if (c >= 70) return "var(--accent-green)";
  if (c >= 40) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

export function rrColor(rr) {
  if (rr == null) return "var(--text-muted)";
  if (rr >= 2) return "var(--accent-green)";
  if (rr >= 1) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

export function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ja-JP");
}

export function formatJPY(v) {
  if (v == null) return "-";
  return `¥${Number(v).toLocaleString()}`;
}

export function formatPct(v) {
  if (v == null) return "-";
  return `${Number(v).toFixed(2)}%`;
}

export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function sentimentColor(sentiment) {
  if (sentiment === "Bullish") return "var(--accent-green)";
  if (sentiment === "Bearish") return "var(--accent-red)";
  return "var(--text-muted)";
}

export function impactBadgeClass(level) {
  if (level === "high") return "badge-sell";
  if (level === "medium") return "badge-hold";
  return "badge-neutral";
}

export function sentimentBadgeClass(sentiment) {
  if (sentiment === "Bullish") return "badge-buy";
  if (sentiment === "Bearish") return "badge-sell";
  return "badge-neutral";
}

export function computeRR(price, stop, target) {
  if (!price || !stop || !target) return null;
  const p = Number(price), s = Number(stop), t = Number(target);
  const risk = Math.abs(p - s);
  const reward = Math.abs(t - p);
  if (risk === 0) return null;
  return (reward / risk).toFixed(1);
}

// --- Value Play UI helpers ---

export function gradeColor(grade) {
  if (grade === "A") return "var(--accent-green)";
  if (grade === "B") return "var(--accent-blue)";
  if (grade === "C") return "var(--accent-yellow)";
  if (grade === "D") return "var(--accent-orange)";
  return "var(--accent-red)";
}

export function gradeBg(grade) {
  if (grade === "A") return "rgba(34, 197, 94, 0.15)";
  if (grade === "B") return "rgba(59, 130, 246, 0.15)";
  if (grade === "C") return "rgba(234, 179, 8, 0.15)";
  if (grade === "D") return "rgba(249, 115, 22, 0.15)";
  return "rgba(239, 68, 68, 0.15)";
}

const CLASSIFICATION_META = {
  DEEP_VALUE: { label: "Deep Value", color: "#22c55e", bg: "rgba(34, 197, 94, 0.15)" },
  QARP: { label: "QARP", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)" },
  DIVIDEND_COMPOUNDER: { label: "Dividend Compounder", color: "#a855f7", bg: "rgba(168, 85, 247, 0.15)" },
  ASSET_PLAY: { label: "Asset Play", color: "#eab308", bg: "rgba(234, 179, 8, 0.15)" },
  RECOVERY_VALUE: { label: "Recovery Value", color: "#f97316", bg: "rgba(249, 115, 22, 0.15)" },
};

export function classificationLabel(cls) {
  return CLASSIFICATION_META[cls]?.label || cls || "-";
}

export function classificationColor(cls) {
  return CLASSIFICATION_META[cls]?.color || "var(--text-muted)";
}

export function classificationBg(cls) {
  return CLASSIFICATION_META[cls]?.bg || "rgba(148, 163, 184, 0.15)";
}

export function valuationColor(value, metric) {
  if (value == null || !Number.isFinite(Number(value))) return "var(--text-muted)";
  const v = Number(value);
  const thresholds = {
    pe: { good: 12, ok: 18, bad: 25 },
    pb: { good: 0.8, ok: 1.2, bad: 2.0 },
    evEbitda: { good: 6, ok: 10, bad: 15 },
    de: { good: 0.5, ok: 1.0, bad: 1.5 },
  };
  const t = thresholds[metric];
  if (!t) {
    // For yield metrics (higher is better)
    if (v >= 5) return "var(--accent-green)";
    if (v >= 2) return "var(--accent-yellow)";
    return "var(--accent-red)";
  }
  // For ratio metrics (lower is better)
  if (v <= t.good) return "var(--accent-green)";
  if (v <= t.ok) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

export function pillarColor(score, max = 25) {
  const pct = (score / max) * 100;
  if (pct >= 72) return "var(--accent-green)";
  if (pct >= 48) return "var(--accent-yellow)";
  return "var(--accent-red)";
}
