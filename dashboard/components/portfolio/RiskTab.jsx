"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import { formatNum } from "../../lib/uiHelpers";

const PIE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#f97316", "#06b6d4", "#ec4899"];

export default function RiskTab({ analytics }) {
  const [sizingCalc, setSizingCalc] = useState({ accountSize: "", riskPct: "1", stopDistance: "" });

  const suggestedShares = useMemo(() => {
    const acct = Number(sizingCalc.accountSize);
    const risk = Number(sizingCalc.riskPct) / 100;
    const stop = Number(sizingCalc.stopDistance);
    if (acct > 0 && risk > 0 && stop > 0) {
      return Math.floor((acct * risk) / stop);
    }
    return 0;
  }, [sizingCalc]);

  if (!analytics) return null;

  return (
    <>
      <div className="grid-2 mb-lg">
        {/* Sector Exposure */}
        <div className="card">
          <div className="card-title mb-md">Sector Exposure</div>
          {analytics.risk.sectorExposure.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={analytics.risk.sectorExposure}
                  dataKey="value"
                  nameKey="sector"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ sector, pct }) => `${sector.substring(0, 12)} ${pct}%`}
                >
                  {analytics.risk.sectorExposure.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#151d2e", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted">No open positions.</p>
          )}
        </div>

        {/* Risk Metrics */}
        <div className="card">
          <div className="card-title mb-md">Risk Metrics</div>
          <div style={{ display: "grid", gap: 12 }}>
            <div className="flex-between">
              <span className="text-secondary">Total Exposure</span>
              <span className="text-mono" style={{ fontWeight: 600 }}>{formatNum(analytics.risk.totalExposure)}</span>
            </div>
            <div className="flex-between">
              <span className="text-secondary">Open Positions</span>
              <span style={{ fontWeight: 600 }}>{analytics.risk.openPositions}</span>
            </div>
            <div className="flex-between">
              <span className="text-secondary">Largest Position</span>
              <span className="text-mono">{analytics.risk.largestPositionPct}%</span>
            </div>
            {analytics.risk.top3.map((p) => (
              <div key={p.ticker} className="flex-between">
                <span className="text-muted">{p.ticker}</span>
                <span className="text-mono">{p.pct}%</span>
              </div>
            ))}
            <hr style={{ border: "none", borderTop: "1px solid var(--border-primary)" }} />
            <div className="flex-between">
              <span className="text-secondary">Portfolio Heat</span>
              <span className="text-mono text-red" style={{ fontWeight: 600 }}>
                {formatNum(analytics.risk.portfolioHeat)}
              </span>
            </div>
            <div className="text-muted" style={{ fontSize: "0.72rem" }}>
              Total loss if all stops are hit simultaneously.
            </div>
          </div>
        </div>
      </div>

      {/* Position Sizing Calculator */}
      <div className="card">
        <div className="card-title mb-md">Position Sizing Calculator</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, alignItems: "end" }}>
          <div>
            <label>Account Size (JPY)</label>
            <input type="number" value={sizingCalc.accountSize} onChange={(e) => setSizingCalc((s) => ({ ...s, accountSize: e.target.value }))} placeholder="1,000,000" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Risk per Trade (%)</label>
            <input type="number" value={sizingCalc.riskPct} onChange={(e) => setSizingCalc((s) => ({ ...s, riskPct: e.target.value }))} step="0.1" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Stop Distance (JPY per share)</label>
            <input type="number" value={sizingCalc.stopDistance} onChange={(e) => setSizingCalc((s) => ({ ...s, stopDistance: e.target.value }))} placeholder="50" style={{ width: "100%" }} />
          </div>
          <div>
            <div className="card-subtitle">Suggested Shares</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--accent-blue)" }}>
              {suggestedShares > 0 ? suggestedShares : "-"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
