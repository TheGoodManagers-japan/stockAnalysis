"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import styles from "./SpaceFund.module.css";
import { formatJPY, formatPct } from "../../lib/uiHelpers";

export default function PerformanceTab({ fund, snapshots, transactions, onTakeSnapshot }) {
  const snapshotChartData = useMemo(() => {
    return snapshots.map((s) => ({
      date: s.snapshot_date,
      value: Number(s.total_value) || 0,
      cost: Number(s.total_cost) || 0,
      pnl: Number(s.unrealized_pnl) || 0,
    }));
  }, [snapshots]);

  return (
    <>
      {/* Key metrics from fund state */}
      {fund && (
        <div className={styles.metricsRow}>
          {[
            ["Total Invested", formatJPY(fund.totalCost)],
            ["Current Value", formatJPY(fund.totalValue)],
            ["Unrealized P&L", formatJPY(fund.unrealizedPnl)],
            ["Return", formatPct(fund.unrealizedPnlPct)],
          ].map(([label, val]) => (
            <div className={styles.summaryCard} key={label}>
              <div className={styles.summaryLabel}>{label}</div>
              <div className={styles.summaryValue} style={{ fontSize: "1.1rem" }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex-between mb-md">
        <div className="card-title">Fund Value Over Time</div>
        <button className="btn btn-sm" onClick={onTakeSnapshot}>Take Snapshot</button>
      </div>

      {snapshotChartData.length > 1 ? (
        <div className="card mb-lg">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={snapshotChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#151d2e", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }}
                formatter={(val) => [formatJPY(val), undefined]}
              />
              <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} name="Value" />
              <Area type="monotone" dataKey="cost" stroke="#64748b" fill="none" strokeWidth={1} strokeDasharray="4 4" name="Cost Basis" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="card mb-lg" style={{ padding: 40, textAlign: "center" }}>
          <p className="text-muted">Take snapshots regularly to build your performance chart.</p>
          <p className="text-muted" style={{ fontSize: "0.8rem" }}>Click &quot;Take Snapshot&quot; to capture today&apos;s fund value.</p>
        </div>
      )}

      {/* Monthly contributions */}
      {transactions.length > 0 && (() => {
        const monthlyMap = new Map();
        for (const tx of transactions) {
          if (tx.transaction_type === "SELL") continue;
          const month = tx.dca_month || tx.transaction_date?.substring(0, 7) || "unknown";
          monthlyMap.set(month, (monthlyMap.get(month) || 0) + Number(tx.total_amount));
        }
        const monthlyData = Array.from(monthlyMap.entries())
          .map(([month, amount]) => ({ month, amount: Math.round(amount) }))
          .sort((a, b) => a.month.localeCompare(b.month));

        if (monthlyData.length === 0) return null;
        return (
          <div className="card">
            <div className="card-title mb-md">Monthly Contributions</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "#151d2e", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} formatter={(val) => [formatJPY(val), "Contributed"]} />
                <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      })()}
    </>
  );
}
