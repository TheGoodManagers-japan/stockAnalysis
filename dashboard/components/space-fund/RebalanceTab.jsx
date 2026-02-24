"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./SpaceFund.module.css";
import { formatNum, formatJPY } from "../../lib/uiHelpers";

export default function RebalanceTab() {
  const [rebalance, setRebalance] = useState(null);
  const [rebalanceLoading, setRebalanceLoading] = useState(false);

  const fetchRebalance = useCallback(async () => {
    setRebalanceLoading(true);
    try {
      const res = await fetch("/api/space-fund/rebalance");
      const data = await res.json();
      if (data.success) setRebalance(data);
    } catch (err) {
      console.error("Failed to fetch rebalance:", err);
    } finally {
      setRebalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRebalance();
  }, [fetchRebalance]);

  return (
    <>
      <div className="flex-between mb-md">
        <div>
          {rebalance?.rebalanceNeeded && (
            <span className="badge badge-sell" style={{ fontSize: "0.75rem" }}>Rebalance Needed</span>
          )}
          {rebalance && !rebalance.rebalanceNeeded && (
            <span className="badge badge-buy" style={{ fontSize: "0.75rem" }}>Balanced</span>
          )}
        </div>
        <button className="btn btn-sm" onClick={fetchRebalance} disabled={rebalanceLoading}>
          {rebalanceLoading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {rebalanceLoading ? (
        <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>
      ) : rebalance ? (
        <div className="card">
          <div className="card-title mb-md">
            Drift Analysis
            <span className="text-muted" style={{ fontSize: "0.75rem", fontWeight: 400, marginLeft: 8 }}>
              Threshold: +/-{rebalance.driftThreshold}% | Total: {formatJPY(rebalance.totalValueJPY)}
            </span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Current %</th>
                  <th>Target %</th>
                  <th>Drift</th>
                  <th>Action</th>
                  <th>Shares</th>
                  <th>Value (JPY)</th>
                </tr>
              </thead>
              <tbody>
                {rebalance.actions.map((a) => (
                  <tr key={a.ticker} style={{ background: a.needsRebalance ? "rgba(239, 68, 68, 0.05)" : "transparent" }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.ticker}</div>
                      <div className="text-muted" style={{ fontSize: "0.7rem" }}>{a.shortName}</div>
                    </td>
                    <td className="text-mono">{a.currentWeightPct.toFixed(1)}%</td>
                    <td className="text-mono">{a.targetWeightPct.toFixed(1)}%</td>
                    <td>
                      <div className={styles.driftBar}>
                        <span className="text-mono" style={{
                          color: Math.abs(a.drift) > rebalance.driftThreshold ? "var(--accent-red)" : a.drift > 0 ? "var(--accent-yellow)" : "var(--accent-green)",
                          fontWeight: 600,
                          fontSize: "0.85rem",
                          minWidth: 50,
                        }}>
                          {a.drift >= 0 ? "+" : ""}{a.drift.toFixed(1)}%
                        </span>
                        <div className={styles.driftBarTrack}>
                          <div className={styles.driftBarCenter} />
                          <div
                            className={styles.driftBarFill}
                            style={{
                              left: a.drift >= 0 ? "50%" : `${50 + (a.drift / 20) * 50}%`,
                              width: `${Math.min(Math.abs(a.drift) / 20 * 50, 50)}%`,
                              background: a.drift > 0 ? "var(--accent-red)" : "var(--accent-green)",
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      {a.action !== "HOLD" ? (
                        <span className={`badge ${a.action === "BUY" ? "badge-buy" : "badge-sell"}`} style={{ fontSize: "0.7rem" }}>
                          {a.action}
                        </span>
                      ) : <span className="text-muted">---</span>}
                    </td>
                    <td className="text-mono">{a.sharesAdjustment > 0 ? formatNum(a.sharesAdjustment) : "-"}</td>
                    <td className="text-mono">{a.valueAdjustmentJPY > 0 ? formatJPY(a.valueAdjustmentJPY) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
