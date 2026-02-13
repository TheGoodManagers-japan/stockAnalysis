"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

export default function ScanHistoryChart({ ticker }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(60);

  useEffect(() => {
    async function fetchHistory() {
      setLoading(true);
      try {
        const res = await fetch(`/api/history-scan?ticker=${ticker}&days=${days}`);
        const json = await res.json();
        if (json.success && json.history) {
          setData(
            json.history.map((h) => ({
              date: new Date(h.scan_date).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }),
              price: Number(h.current_price),
              tier: h.tier,
              fundamental: Number(h.fundamental_score) || 0,
              valuation: Number(h.valuation_score) || 0,
              stScore: h.short_term_score,
              ltScore: h.long_term_score,
              isBuy: h.is_buy_now ? 1 : 0,
            }))
          );
        }
      } catch (err) {
        console.error("Failed to fetch scan history:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [ticker, days]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <span className="spinner" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-muted" style={{ padding: 20, textAlign: "center" }}>
        No scan history yet. Run multiple daily scans to see trends.
      </div>
    );
  }

  return (
    <div>
      <div className="flex-between mb-sm">
        <div style={{ display: "flex", gap: 6 }}>
          {[30, 60, 90].map((d) => (
            <button
              key={d}
              className={`btn btn-sm ${d === days ? "btn-primary" : ""}`}
              onClick={() => setDays(d)}
              style={{ fontSize: "0.75rem" }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} />
          <YAxis
            yAxisId="price"
            orientation="left"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            domain={["auto", "auto"]}
          />
          <YAxis
            yAxisId="score"
            orientation="right"
            domain={[0, 10]}
            tick={{ fill: "#64748b", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              background: "#151d2e",
              border: "1px solid #334155",
              borderRadius: 8,
              color: "#e2e8f0",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="price"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            name="Price"
          />
          <Line
            yAxisId="score"
            type="monotone"
            dataKey="fundamental"
            stroke="#22c55e"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={false}
            name="Fundamental"
          />
          <Line
            yAxisId="score"
            type="monotone"
            dataKey="valuation"
            stroke="#eab308"
            strokeWidth={1}
            strokeDasharray="4 2"
            dot={false}
            name="Valuation"
          />
          <Bar
            yAxisId="score"
            dataKey="isBuy"
            fill="#22c55e"
            opacity={0.3}
            name="Buy Signal"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
