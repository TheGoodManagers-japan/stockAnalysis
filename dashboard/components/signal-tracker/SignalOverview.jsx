"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import styles from "./SignalTracker.module.css";

function StatCard({ label, value, className }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.label}>{label}</div>
      <div className={`${styles.value} ${className || ""}`}>{value}</div>
    </div>
  );
}

function SourceCard({ source }) {
  const name =
    source.source === "scanner"
      ? "Scanner Signals"
      : source.source === "value_play"
        ? "Value Plays"
        : "Space Fund";

  return (
    <div className={styles.sourceCard}>
      <h3>{name}</h3>
      <div className={styles.miniStats}>
        <div className={styles.miniStat}>
          <span>Open: </span>
          {source.open || 0}
        </div>
        <div className={styles.miniStat}>
          <span>Closed: </span>
          {source.closed || 0}
        </div>
        <div className={styles.miniStat}>
          <span>Wins: </span>
          <span style={{ color: "var(--accent-green)" }}>{source.wins || 0}</span>
        </div>
        <div className={styles.miniStat}>
          <span>Losses: </span>
          <span style={{ color: "var(--accent-red)" }}>{source.losses || 0}</span>
        </div>
        <div className={styles.miniStat}>
          <span>Win Rate: </span>
          {source.win_rate != null ? `${source.win_rate}%` : "—"}
        </div>
        <div className={styles.miniStat}>
          <span>Avg P&L: </span>
          <span
            style={{
              color:
                source.avg_pnl > 0
                  ? "var(--accent-green)"
                  : source.avg_pnl < 0
                    ? "var(--accent-red)"
                    : undefined,
            }}
          >
            {source.avg_pnl != null ? `${source.avg_pnl}%` : "—"}
          </span>
        </div>
        <div className={styles.miniStat}>
          <span>Avg R: </span>
          {source.avg_r != null ? `${source.avg_r}R` : "—"}
        </div>
      </div>
    </div>
  );
}

export default function SignalOverview({ stats }) {
  if (!stats) {
    return <div className={styles.emptyState}>Loading stats...</div>;
  }

  const { overall, bySource, monthlyCurve } = stats;
  const o = overall || {};

  const winRate = o.win_rate != null ? `${o.win_rate}%` : "—";
  const avgPnl = o.avg_pnl_pct != null ? `${o.avg_pnl_pct}%` : "—";
  const avgR = o.avg_r_multiple != null ? `${o.avg_r_multiple}R` : "—";
  const avgDays = o.avg_holding_days != null ? `${o.avg_holding_days}d` : "—";

  // Monthly chart data with cumulative P&L
  let cumPnl = 0;
  const chartData = (monthlyCurve || []).map((m) => {
    cumPnl += Number(m.total_pnl_pct) || 0;
    return {
      month: m.month,
      pnl: Number(m.total_pnl_pct) || 0,
      cumPnl: Math.round(cumPnl * 100) / 100,
      trades: Number(m.trades) || 0,
      wins: Number(m.wins) || 0,
      losses: Number(m.losses) || 0,
    };
  });

  return (
    <div>
      {/* Summary cards */}
      <div className={styles.statsGrid}>
        <StatCard label="Total Signals" value={Number(o.total_closed || 0) + Number(o.total_open || 0)} />
        <StatCard label="Open" value={o.total_open || 0} />
        <StatCard label="Win Rate" value={winRate} className={Number(o.win_rate) >= 50 ? styles.positive : ""} />
        <StatCard label="Avg P&L" value={avgPnl} className={Number(o.avg_pnl_pct) > 0 ? styles.positive : Number(o.avg_pnl_pct) < 0 ? styles.negative : ""} />
        <StatCard label="Avg R-Multiple" value={avgR} className={Number(o.avg_r_multiple) > 0 ? styles.positive : ""} />
        <StatCard label="Avg Hold" value={avgDays} />
      </div>

      {/* By source */}
      {bySource && bySource.length > 0 && (
        <div className={styles.sourceGrid}>
          {bySource.map((s) => (
            <SourceCard key={s.source} source={s} />
          ))}
        </div>
      )}

      {/* Monthly P&L chart */}
      {chartData.length > 0 && (
        <div className={styles.chartSection}>
          <h3>Monthly P&L (Closed Trades)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value, name) => [
                  name === "pnl" ? `${value}%` : value,
                  name === "pnl" ? "P&L" : name,
                ]}
              />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {Number(o.total_closed || 0) === 0 && Number(o.total_open || 0) === 0 && (
        <div className={styles.emptyState}>
          No signals tracked yet. Run a scan to start recording paper trades.
        </div>
      )}
    </div>
  );
}
