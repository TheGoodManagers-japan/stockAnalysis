"use client";

import { useState } from "react";
import styles from "./SpaceFund.module.css";

function formatPrice(val, currency = "USD") {
  if (val == null) return "—";
  return currency === "JPY"
    ? `¥${Number(val).toLocaleString()}`
    : `$${Number(val).toFixed(2)}`;
}

function RegimeBadge({ regime }) {
  if (!regime) return null;
  const colors = {
    STRONG_UP: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
    UP: { bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" },
    RANGE: { bg: "rgba(234, 179, 8, 0.15)", color: "#eab308" },
    DOWN: { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
  };
  const c = colors[regime] || colors.RANGE;
  return (
    <span
      style={{
        fontSize: "0.65rem",
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: "var(--radius-sm)",
        background: c.bg,
        color: c.color,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}
    >
      {regime.replace("_", " ")}
    </span>
  );
}

function SignalBadge({ isBuyNow, triggerType }) {
  if (isBuyNow) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(16, 185, 129, 0.2)",
            color: "#10b981",
            border: "1px solid rgba(16, 185, 129, 0.3)",
          }}
        >
          BUY
        </span>
        {triggerType && (
          <span
            style={{
              fontSize: "0.65rem",
              fontWeight: 600,
              padding: "2px 6px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(59, 130, 246, 0.12)",
              color: "var(--accent-blue)",
            }}
          >
            {triggerType}
          </span>
        )}
      </div>
    );
  }
  return (
    <span
      style={{
        fontSize: "0.75rem",
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-tertiary)",
        color: "var(--text-muted)",
      }}
    >
      WAIT
    </span>
  );
}

function SignalCard({ signal }) {
  const [expanded, setExpanded] = useState(false);
  const details = signal.details_json || {};
  const isBuy = signal.is_buy_now;

  return (
    <div
      className={styles.signalCard}
      data-signal={isBuy ? "buy" : "wait"}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--accent-blue)" }}>
              {signal.ticker_code}
            </span>
            <span className={styles.categoryBadge}>{signal.category}</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
            {signal.short_name} · {(signal.target_weight * 100).toFixed(0)}% target
          </div>
        </div>
        <SignalBadge isBuyNow={isBuy} triggerType={signal.trigger_type} />
      </div>

      {/* Price row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isBuy ? "1fr 1fr 1fr 1fr" : "1fr 1fr",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Price</div>
          <div style={{ fontSize: "0.95rem", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
            {formatPrice(signal.current_price)}
          </div>
        </div>
        {isBuy && (
          <>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Stop</div>
              <div style={{ fontSize: "0.85rem", fontFamily: "var(--font-mono)", color: "#ef4444" }}>
                {formatPrice(signal.stop_loss)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Target</div>
              <div style={{ fontSize: "0.85rem", fontFamily: "var(--font-mono)", color: "#10b981" }}>
                {formatPrice(signal.price_target)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>R:R</div>
              <div
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  color: signal.rr_ratio >= 2 ? "#10b981" : signal.rr_ratio >= 1.5 ? "#eab308" : "#ef4444",
                }}
              >
                {signal.rr_ratio ? `${signal.rr_ratio.toFixed(1)}:1` : "—"}
              </div>
            </div>
          </>
        )}
        {!isBuy && (
          <div>
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>RSI</div>
            <div style={{ fontSize: "0.85rem", fontFamily: "var(--font-mono)" }}>
              {signal.rsi_14 ? signal.rsi_14.toFixed(1) : "—"}
            </div>
          </div>
        )}
      </div>

      {/* Technicals row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <RegimeBadge regime={signal.market_regime} />
        {signal.rsi_14 != null && isBuy && (
          <span
            style={{
              fontSize: "0.65rem",
              padding: "1px 6px",
              borderRadius: "var(--radius-sm)",
              background:
                signal.rsi_14 < 30
                  ? "rgba(16, 185, 129, 0.15)"
                  : signal.rsi_14 > 70
                  ? "rgba(239, 68, 68, 0.15)"
                  : "var(--bg-tertiary)",
              color:
                signal.rsi_14 < 30
                  ? "#10b981"
                  : signal.rsi_14 > 70
                  ? "#ef4444"
                  : "var(--text-muted)",
              fontWeight: 600,
            }}
          >
            RSI {signal.rsi_14.toFixed(0)}
          </span>
        )}
        {details.limitBuyOrder && isBuy && (
          <span
            style={{
              fontSize: "0.65rem",
              padding: "1px 6px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(139, 92, 246, 0.12)",
              color: "#8b5cf6",
              fontWeight: 600,
            }}
          >
            Limit {formatPrice(details.limitBuyOrder)}
          </span>
        )}
        {details.catalystScore != null && details.catalystScore !== 5.0 && (
          <span
            title={details.catalystReason || "Catalyst score"}
            style={{
              fontSize: "0.65rem",
              padding: "1px 6px",
              borderRadius: "var(--radius-sm)",
              background:
                details.catalystScore >= 7
                  ? "rgba(16, 185, 129, 0.15)"
                  : details.catalystScore < 4
                  ? "rgba(239, 68, 68, 0.15)"
                  : "var(--bg-tertiary)",
              color:
                details.catalystScore >= 7
                  ? "#10b981"
                  : details.catalystScore < 4
                  ? "#ef4444"
                  : "var(--text-muted)",
              fontWeight: 600,
            }}
          >
            Cat {details.catalystScore.toFixed(1)}
          </span>
        )}
      </div>

      {/* Reason (expandable) */}
      {signal.buy_now_reason && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            lineHeight: 1.4,
            overflow: expanded ? "visible" : "hidden",
            maxHeight: expanded ? "none" : "2.8em",
            cursor: "pointer",
          }}
        >
          {signal.buy_now_reason}
        </div>
      )}
      {signal.buy_now_reason && signal.buy_now_reason.length > 100 && (
        <div
          style={{
            fontSize: "0.65rem",
            color: "var(--accent-blue)",
            cursor: "pointer",
            marginTop: 2,
          }}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          {expanded ? "Show less" : "Show more"}
        </div>
      )}
    </div>
  );
}

export default function SignalsTab({ signals, loading }) {
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <span className="spinner" />
      </div>
    );
  }

  const signalList = signals?.signals || [];
  const summary = signals?.summary || {};
  const signalDate = signals?.signalDate;

  return (
    <div>
      {/* Header */}
      <div className={styles.signalHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {signalDate && (
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {new Date(signalDate).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
          {summary.buyCount > 0 && (
            <span className={styles.signalCountBadge} data-type="buy">
              {summary.buyCount} BUY
            </span>
          )}
          {summary.waitCount > 0 && (
            <span className={styles.signalCountBadge} data-type="wait">
              {summary.waitCount} WAIT
            </span>
          )}
          {summary.lastUpdated && (
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              Updated {new Date(summary.lastUpdated).toLocaleTimeString()}
              {summary.source === "cron" ? " (auto)" : " (manual)"}
            </span>
          )}
        </div>
        <div />
      </div>

      {/* Empty state */}
      {signalList.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          <p>No signals yet. Click &quot;Refresh Signals&quot; to run analysis.</p>
        </div>
      )}

      {/* Signal cards */}
      <div className={styles.signalGrid}>
        {signalList.map((signal) => (
          <SignalCard key={signal.ticker_code} signal={signal} />
        ))}
      </div>
    </div>
  );
}
