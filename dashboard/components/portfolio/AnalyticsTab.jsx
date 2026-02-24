"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { formatNum } from "../../lib/uiHelpers";

export default function AnalyticsTab({ analytics }) {
  if (!analytics) return null;

  const { performance, equityCurve, monthlyPnl } = analytics;

  return (
    <>
      {/* Key Metrics */}
      <div className="grid-4 mb-lg">
        {[
          ["Win Rate", `${performance.winRate}%`, performance.winRate >= 50 ? "var(--accent-green)" : "var(--accent-red)"],
          ["Avg R-Multiple", performance.avgRMultiple, performance.avgRMultiple >= 0 ? "var(--accent-green)" : "var(--accent-red)"],
          ["Expectancy", `${performance.expectancy}%`, performance.expectancy >= 0 ? "var(--accent-green)" : "var(--accent-red)"],
          ["Max Drawdown", `${performance.maxDrawdownPct}%`, "var(--accent-red)"],
        ].map(([label, val, color]) => (
          <div className="card" key={label}>
            <div className="card-subtitle">{label}</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color }}>{val}</div>
          </div>
        ))}
      </div>

      <div className="grid-2 mb-lg">
        {[
          ["Total Trades", performance.totalTrades],
          ["Wins / Losses", `${performance.winCount} / ${performance.lossCount}`],
          ["Profit Factor", performance.profitFactor],
          ["Net P&L", formatNum(performance.netPnl)],
          ["Avg Win", `${performance.avgWinPct}%`],
          ["Avg Loss", `${performance.avgLossPct}%`],
        ].map(([label, val]) => (
          <div key={label} className="flex-between" style={{ padding: "6px 0", borderBottom: "1px solid var(--border-primary)" }}>
            <span className="text-secondary">{label}</span>
            <span className="text-mono" style={{ fontWeight: 600 }}>{val}</span>
          </div>
        ))}
      </div>

      {/* Equity Curve */}
      {equityCurve.length > 0 && (
        <div className="card mb-lg">
          <div className="card-title mb-md">Equity Curve (Cumulative P&L)</div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={equityCurve}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#151d2e", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
              <Area type="monotone" dataKey="pnl" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly P&L */}
      {monthlyPnl.length > 0 && (
        <div className="card mb-lg">
          <div className="card-title mb-md">Monthly P&L</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyPnl}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#151d2e", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
              <Bar dataKey="pnl" fill="#3b82f6">
                {monthlyPnl.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
