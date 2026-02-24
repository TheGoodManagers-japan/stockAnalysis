"use client";

/** Generic badge wrapper using global .badge CSS classes */
export function Badge({ children, variant = "neutral", className = "", style }) {
  return (
    <span className={`badge badge-${variant} ${className}`} style={style}>
      {children}
    </span>
  );
}

/** Tier badge (1=best, 5=worst) */
export function TierBadge({ tier }) {
  const t = tier || "?";
  return <span className={`badge badge-tier-${t}`}>T{t}</span>;
}

/** Buy/Sell signal badge */
export function SignalBadge({ isBuy }) {
  if (isBuy) return <span className="badge badge-buy">BUY</span>;
  return <span className="badge badge-neutral">-</span>;
}

/** Market regime badge (STRONG_UP, UP, RANGE, DOWN) */
export function RegimeBadge({ regime }) {
  const label = regime || "-";
  let cls = "badge-neutral";
  if (label === "STRONG_UP" || label === "UP") cls = "badge-buy";
  else if (label === "DOWN") cls = "badge-sell";
  return <span className={`badge ${cls}`}>{label}</span>;
}

/** Signal tracking outcome badge */
export function OutcomeBadge({ outcome }) {
  const map = {
    target_hit: { label: "Target Hit", cls: "badge-buy" },
    stop_hit: { label: "Stop Hit", cls: "badge-sell" },
    open_profit: { label: "Open +", cls: "badge-buy" },
    open_loss: { label: "Open -", cls: "badge-sell" },
  };
  const cfg = map[outcome] || { label: outcome || "-", cls: "badge-neutral" };
  return <span className={`badge ${cfg.cls}`}>{cfg.label}</span>;
}

/** News sentiment badge */
export function SentimentBadge({ sentiment }) {
  let cls = "badge-neutral";
  if (sentiment === "Bullish") cls = "badge-buy";
  else if (sentiment === "Bearish") cls = "badge-sell";
  return <span className={`badge ${cls}`}>{sentiment || "-"}</span>;
}

/** News impact level badge */
export function ImpactBadge({ level }) {
  let cls = "badge-neutral";
  if (level === "high") cls = "badge-sell";
  else if (level === "medium") cls = "badge-hold";
  return <span className={`badge ${cls}`}>{level || "-"}</span>;
}
