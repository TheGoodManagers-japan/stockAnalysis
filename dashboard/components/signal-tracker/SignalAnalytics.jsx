"use client";

import styles from "./SignalTracker.module.css";

function WinRateBar({ label, winRate, total, avgPnl }) {
  const rate = Number(winRate) || 0;
  const barColor =
    rate >= 60 ? "#22c55e" : rate >= 45 ? "#eab308" : "#ef4444";

  return (
    <div className={styles.barRow}>
      <div className={styles.barLabel}>{label}</div>
      <div className={styles.barTrack}>
        <div
          className={styles.barFill}
          style={{ width: `${Math.min(rate, 100)}%`, background: barColor }}
        />
      </div>
      <div className={styles.barValue}>
        {rate > 0 ? `${rate}%` : "—"}
      </div>
      <div style={{ minWidth: 60, fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "right" }}>
        {total} trades
      </div>
      <div
        style={{
          minWidth: 60,
          fontSize: "0.75rem",
          textAlign: "right",
          color:
            Number(avgPnl) > 0
              ? "var(--accent-green)"
              : Number(avgPnl) < 0
                ? "var(--accent-red)"
                : "var(--text-muted)",
        }}
      >
        {avgPnl != null ? `${avgPnl}%` : "—"}
      </div>
    </div>
  );
}

export default function SignalAnalytics({ stats }) {
  if (!stats) {
    return <div className={styles.emptyState}>Loading analytics...</div>;
  }

  const { byTrigger } = stats;

  if (!byTrigger || byTrigger.length === 0) {
    return (
      <div className={styles.emptyState}>
        No closed trades yet. Analytics will appear after signals are resolved.
      </div>
    );
  }

  // Group by source for display
  const scannerTriggers = byTrigger.filter((t) => t.source === "scanner");
  const valueTriggers = byTrigger.filter((t) => t.source === "value_play");
  const fundTriggers = byTrigger.filter((t) => t.source === "space_fund");

  return (
    <div>
      {/* Scanner triggers breakdown */}
      {scannerTriggers.length > 0 && (
        <div className={styles.chartSection}>
          <h3>Scanner — Win Rate by Trigger Type</h3>
          <div style={{ marginBottom: 8, display: "flex", gap: 60, fontSize: "0.72rem", color: "var(--text-muted)" }}>
            <span>Trigger</span>
            <span style={{ flex: 1 }} />
            <span style={{ minWidth: 50, textAlign: "right" }}>Win %</span>
            <span style={{ minWidth: 60, textAlign: "right" }}>Trades</span>
            <span style={{ minWidth: 60, textAlign: "right" }}>Avg P&L</span>
          </div>
          {scannerTriggers.map((t) => (
            <WinRateBar
              key={`scanner-${t.trigger_type}`}
              label={t.trigger_type || "Unknown"}
              winRate={t.win_rate}
              total={t.total}
              avgPnl={t.avg_pnl}
            />
          ))}
        </div>
      )}

      {/* Value play classifications breakdown */}
      {valueTriggers.length > 0 && (
        <div className={styles.chartSection}>
          <h3>Value Plays — Win Rate by Classification</h3>
          <div style={{ marginBottom: 8, display: "flex", gap: 60, fontSize: "0.72rem", color: "var(--text-muted)" }}>
            <span>Class</span>
            <span style={{ flex: 1 }} />
            <span style={{ minWidth: 50, textAlign: "right" }}>Win %</span>
            <span style={{ minWidth: 60, textAlign: "right" }}>Trades</span>
            <span style={{ minWidth: 60, textAlign: "right" }}>Avg P&L</span>
          </div>
          {valueTriggers.map((t) => (
            <WinRateBar
              key={`vp-${t.trigger_type}`}
              label={t.trigger_type || "Unknown"}
              winRate={t.win_rate}
              total={t.total}
              avgPnl={t.avg_pnl}
            />
          ))}
        </div>
      )}

      {/* Space fund breakdown */}
      {fundTriggers.length > 0 && (
        <div className={styles.chartSection}>
          <h3>Space Fund — Win Rate by Transaction Type</h3>
          {fundTriggers.map((t) => (
            <WinRateBar
              key={`sf-${t.trigger_type}`}
              label={t.trigger_type || "Unknown"}
              winRate={t.win_rate}
              total={t.total}
              avgPnl={t.avg_pnl}
            />
          ))}
        </div>
      )}
    </div>
  );
}
