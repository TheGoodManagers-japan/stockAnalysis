"use client";

import { useState, useEffect } from "react";

function formatNum(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString();
}

export default function BacktestPage() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetchRuns();
  }, []);

  async function fetchRuns() {
    try {
      const res = await fetch("/api/backtest");
      const data = await res.json();
      if (data.success) {
        setRuns(data.runs || []);
      }
    } catch (err) {
      console.error("Failed to fetch backtest runs:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRunBacktest() {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "balanced" }),
      });
      if (res.ok) {
        fetchRuns();
      }
    } catch (err) {
      console.error("Backtest failed:", err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="flex-between mb-lg">
        <h2 style={{ color: "var(--text-heading)" }}>Backtesting</h2>
        <button
          className="btn btn-primary"
          onClick={handleRunBacktest}
          disabled={running}
        >
          {running && <span className="spinner" />}
          {running ? "Running..." : "Run Backtest"}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <span className="spinner" />
        </div>
      ) : runs.length === 0 ? (
        <div className="card">
          <p className="text-muted">
            No backtest results yet. Click &quot;Run Backtest&quot; to start.
          </p>
        </div>
      ) : (
        <>
          {runs.map((run) => (
            <div key={run.id} className="card mb-md">
              <div className="card-header">
                <div className="card-title">
                  Backtest #{run.id}
                  <span
                    className="text-muted"
                    style={{ fontWeight: 400, marginLeft: 8, fontSize: "0.8rem" }}
                  >
                    {run.run_date
                      ? new Date(run.run_date).toLocaleString("ja-JP")
                      : ""}
                  </span>
                </div>
              </div>

              <div className="grid-4 mb-md">
                <div>
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                    Total Trades
                  </div>
                  <div
                    className="text-mono"
                    style={{ fontSize: "1.2rem", fontWeight: 700 }}
                  >
                    {run.total_trades ?? "-"}
                  </div>
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                    Win Rate
                  </div>
                  <div
                    className="text-mono"
                    style={{
                      fontSize: "1.2rem",
                      fontWeight: 700,
                      color:
                        Number(run.win_rate) >= 50
                          ? "var(--accent-green)"
                          : "var(--accent-red)",
                    }}
                  >
                    {run.win_rate != null
                      ? `${Number(run.win_rate).toFixed(1)}%`
                      : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                    Avg R-Multiple
                  </div>
                  <div
                    className="text-mono"
                    style={{
                      fontSize: "1.2rem",
                      fontWeight: 700,
                      color:
                        Number(run.avg_r_multiple) > 0
                          ? "var(--accent-green)"
                          : "var(--accent-red)",
                    }}
                  >
                    {run.avg_r_multiple != null
                      ? Number(run.avg_r_multiple).toFixed(2)
                      : "-"}
                  </div>
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                    Max Drawdown
                  </div>
                  <div
                    className="text-mono text-red"
                    style={{ fontSize: "1.2rem", fontWeight: 700 }}
                  >
                    {run.max_drawdown_pct != null
                      ? `${Number(run.max_drawdown_pct).toFixed(1)}%`
                      : "-"}
                  </div>
                </div>
              </div>

              <div className="grid-2">
                <div>
                  <span className="text-muted">Wins</span>
                  <span className="text-green" style={{ marginLeft: 8 }}>
                    {run.win_count ?? "-"}
                  </span>
                </div>
                <div>
                  <span className="text-muted">Losses</span>
                  <span className="text-red" style={{ marginLeft: 8 }}>
                    {run.loss_count ?? "-"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
