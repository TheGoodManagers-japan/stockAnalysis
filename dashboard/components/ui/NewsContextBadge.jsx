"use client";

/**
 * Compact badge showing news activity for a ticker.
 *
 * Props:
 *   articleCount  — number of articles in last 7 days
 *   avgSentiment  — numeric sentiment score (-1 to 1)
 *   maxImpact     — "high" | "medium" | "low"
 *   onWatchlist   — boolean, on today's news watchlist
 *   latestHeadline — most recent article title (tooltip)
 *   compact       — if true, minimal display for table cells
 */
export default function NewsContextBadge({
  articleCount,
  avgSentiment,
  maxImpact,
  onWatchlist,
  latestHeadline,
  compact = false,
}) {
  if (!articleCount || articleCount === 0) {
    return compact ? <span style={{ color: "var(--text-muted)" }}>-</span> : null;
  }

  const sentimentLabel =
    avgSentiment > 0.3 ? "Bullish" : avgSentiment < -0.3 ? "Bearish" : "Neutral";
  const sentimentColorVal =
    sentimentLabel === "Bullish"
      ? "var(--accent-green)"
      : sentimentLabel === "Bearish"
      ? "var(--accent-red)"
      : "var(--text-muted)";

  if (compact) {
    return (
      <div
        style={{ display: "flex", alignItems: "center", gap: 4 }}
        title={latestHeadline || `${articleCount} articles (${sentimentLabel})`}
      >
        {maxImpact === "high" && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.2)",
              color: "var(--accent-red)",
              fontSize: "0.6rem",
              fontWeight: 700,
            }}
          >
            !
          </span>
        )}
        <span
          style={{
            color: sentimentColorVal,
            fontSize: "0.78rem",
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
          }}
        >
          {articleCount}
        </span>
        {onWatchlist && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--accent-purple)",
              display: "inline-block",
            }}
            title="On news watchlist"
          />
        )}
      </div>
    );
  }

  // Full mode — for cards and expanded views
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span
        className={`badge ${
          maxImpact === "high"
            ? "badge-sell"
            : maxImpact === "medium"
            ? "badge-hold"
            : "badge-neutral"
        }`}
        style={{ fontSize: "0.65rem" }}
        title={latestHeadline}
      >
        {articleCount} news
      </span>
      <span
        style={{
          fontSize: "0.65rem",
          color: sentimentColorVal,
          fontWeight: 600,
        }}
      >
        {sentimentLabel}
      </span>
      {onWatchlist && (
        <span
          style={{
            fontSize: "0.6rem",
            color: "var(--accent-purple)",
            fontWeight: 600,
            background: "rgba(168, 85, 247, 0.15)",
            padding: "1px 5px",
            borderRadius: 4,
          }}
        >
          WATCHLIST
        </span>
      )}
    </div>
  );
}
