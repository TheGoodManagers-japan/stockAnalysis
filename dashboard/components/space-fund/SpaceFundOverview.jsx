"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
} from "recharts";
import styles from "./SpaceFund.module.css";
import { formatNum, formatJPY, formatPct } from "../../lib/uiHelpers";

const PIE_COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7",
  "#f97316", "#06b6d4", "#ec4899", "#10b981", "#f43f5e",
  "#6366f1", "#84cc16",
];

export default function SpaceFundOverview({ fund, members, transactions, loading }) {
  const pieData = useMemo(() => {
    if (!members.length) return [];
    return members.map((m) => ({
      name: m.ticker_code,
      target: Number(m.target_weight) * 100,
      current: (m.currentWeight || 0) * 100,
    }));
  }, [members]);

  return (
    <>
      {/* Summary cards */}
      <div className={styles.summaryGrid}>
        {[
          ["Total Value", formatJPY(fund?.totalValue), "var(--text-heading)"],
          ["Total Cost", formatJPY(fund?.totalCost), "var(--text-secondary)"],
          ["Unrealized P&L", formatJPY(fund?.unrealizedPnl), fund?.unrealizedPnl >= 0 ? "var(--accent-green)" : "var(--accent-red)"],
          ["P&L %", formatPct(fund?.unrealizedPnlPct), fund?.unrealizedPnlPct >= 0 ? "var(--accent-green)" : "var(--accent-red)"],
          ["Members", fund?.memberCount || 0, "var(--accent-blue)"],
          ["USD/JPY", fund?.usdJpyRate ? `¥${Number(fund.usdJpyRate).toFixed(2)}` : "-", "var(--text-secondary)"],
        ].map(([label, val, color]) => (
          <div className={styles.summaryCard} key={label}>
            <div className={styles.summaryLabel}>{label}</div>
            <div className={styles.summaryValue} style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Holdings + Pie */}
      <div className={styles.holdingsLayout}>
        {/* Holdings table */}
        <div className="card">
          <div className="card-title mb-md">Holdings</div>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center" }}><span className="spinner" /></div>
          ) : members.length === 0 ? (
            <p className="text-muted">No members yet. Add stocks to your space fund.</p>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Category</th>
                    <th>Shares</th>
                    <th>Avg Cost</th>
                    <th>Price</th>
                    <th>Value (JPY)</th>
                    <th>P&L %</th>
                    <th>Weight</th>
                    <th>Target</th>
                    <th>Drift</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.ticker_code}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{m.ticker_code}</div>
                        <div className="text-muted" style={{ fontSize: "0.7rem" }}>{m.short_name}</div>
                      </td>
                      <td>{m.category ? <span className={styles.categoryBadge}>{m.category}</span> : "-"}</td>
                      <td className="text-mono">{m.shares > 0 ? formatNum(m.shares) : "-"}</td>
                      <td className="text-mono">{m.avgCost > 0 ? (m.currency === "JPY" ? `¥${formatNum(Math.round(m.avgCost))}` : `$${m.avgCost.toFixed(2)}`) : "-"}</td>
                      <td className="text-mono">{m.currentPrice > 0 ? (m.currency === "JPY" ? `¥${formatNum(m.currentPrice)}` : `$${m.currentPrice.toFixed(2)}`) : "-"}</td>
                      <td className="text-mono">{m.currentValueJPY > 0 ? formatJPY(Math.round(m.currentValueJPY)) : "-"}</td>
                      <td className="text-mono" style={{ color: m.pnlPct >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                        {m.shares > 0 ? formatPct(m.pnlPct) : "-"}
                      </td>
                      <td className="text-mono">{m.currentWeight != null ? formatPct(m.currentWeight * 100) : "-"}</td>
                      <td className="text-mono">{formatPct(Number(m.target_weight) * 100)}</td>
                      <td>
                        {m.drift != null && m.shares > 0 ? (
                          <span style={{ color: Math.abs(m.drift * 100) > 5 ? "var(--accent-red)" : "var(--text-muted)", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                            {m.drift >= 0 ? "+" : ""}{(m.drift * 100).toFixed(1)}%
                          </span>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Allocation pie chart */}
        <div className="card">
          <div className="card-title mb-md">Allocation</div>
          {pieData.length > 0 ? (
            <div className={styles.pieContainer}>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="target"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    innerRadius={40}
                    label={({ name, target }) => `${name} ${target.toFixed(0)}%`}
                    labelLine={false}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend
                    wrapperStyle={{ fontSize: "0.7rem" }}
                    formatter={(value) => <span style={{ color: "var(--text-secondary)" }}>{value}</span>}
                  />
                  <Tooltip
                    contentStyle={{ background: "#151d2e", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }}
                    formatter={(val, name, { payload }) => [`Target: ${val.toFixed(1)}% | Current: ${payload.current.toFixed(1)}%`, payload.name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-muted">Add members to see allocation.</p>
          )}
        </div>
      </div>

      {/* Recent transactions */}
      {transactions.length > 0 && (
        <div className="card">
          <div className="card-title mb-md">Recent Transactions</div>
          {transactions.slice(0, 10).map((tx) => (
            <div key={tx.id} className={styles.txRow}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={`badge ${tx.transaction_type === "SELL" ? "badge-sell" : "badge-buy"}`} style={{ fontSize: "0.65rem" }}>
                  {tx.transaction_type}
                </span>
                <span style={{ fontWeight: 600 }}>{tx.ticker_code}</span>
                <span className="text-muted">{tx.shares} shares @ {tx.currency === "JPY" ? `¥${formatNum(Number(tx.price_per_share))}` : `$${Number(tx.price_per_share).toFixed(2)}`}</span>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="text-mono" style={{ fontWeight: 600 }}>{tx.currency === "JPY" ? formatJPY(Number(tx.total_amount)) : `$${Number(tx.total_amount).toFixed(2)}`}</span>
                <span className="text-muted" style={{ fontSize: "0.72rem" }}>{tx.transaction_date}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
