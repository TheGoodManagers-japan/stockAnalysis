"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./SpaceFund.module.css";
import { formatNum, formatJPY } from "../../lib/uiHelpers";

export default function DCAPlannerTab() {
  const [dcaBudget, setDcaBudget] = useState("100000");
  const [dcaPlan, setDcaPlan] = useState(null);
  const [dcaLoading, setDcaLoading] = useState(false);

  const fetchDCAPlan = useCallback(async (budget) => {
    setDcaLoading(true);
    try {
      const res = await fetch(`/api/space-fund/dca-plan?budget=${budget}`);
      const data = await res.json();
      if (data.success) setDcaPlan(data);
    } catch (err) {
      console.error("Failed to fetch DCA plan:", err);
    } finally {
      setDcaLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDCAPlan(Number(dcaBudget) || 100000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className={styles.budgetInput}>
        <label style={{ fontWeight: 600 }}>Monthly Budget (JPY):</label>
        <input
          type="number"
          value={dcaBudget}
          onChange={(e) => setDcaBudget(e.target.value)}
          style={{ maxWidth: 180 }}
        />
        <button className="btn btn-primary btn-sm" onClick={() => fetchDCAPlan(Number(dcaBudget) || 100000)} disabled={dcaLoading}>
          {dcaLoading ? "Calculating..." : "Calculate"}
        </button>
      </div>

      {dcaLoading ? (
        <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /> Fetching live prices...</div>
      ) : dcaPlan ? (
        <div className="card">
          <div className="card-title mb-md">DCA Allocation Plan</div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Weight</th>
                  <th>Allocation</th>
                  <th>Price</th>
                  <th>Shares</th>
                  <th>Amount</th>
                  <th>Signal</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {dcaPlan.plan.map((item) => (
                  <tr key={item.ticker}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.ticker}</div>
                      <div className="text-muted" style={{ fontSize: "0.7rem" }}>{item.shortName}</div>
                    </td>
                    <td className="text-mono">{(item.targetWeight * 100).toFixed(0)}%</td>
                    <td className="text-mono">{formatJPY(Math.round(item.rawAllocationJPY))}</td>
                    <td className="text-mono">
                      {item.currentPrice > 0
                        ? item.currency === "JPY" ? `¥${formatNum(item.currentPrice)}` : `$${item.currentPrice.toFixed(2)}`
                        : <span className="text-red">N/A</span>
                      }
                    </td>
                    <td className="text-mono" style={{ fontWeight: 600 }}>
                      {item.shares > 0 ? (item.exchange === "JPX" ? formatNum(item.shares) : item.shares.toFixed(4)) : "-"}
                      {item.exchange === "JPX" && item.shares > 0 && <span className="text-muted" style={{ fontSize: "0.65rem" }}> lots</span>}
                    </td>
                    <td className="text-mono">
                      {item.currency === "JPY" ? formatJPY(Math.round(item.actualAmountLocal)) : `$${item.actualAmountLocal.toFixed(2)}`}
                    </td>
                    <td>
                      {item.signal ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span className={`badge ${item.signal.isBuyNow ? "badge-buy" : "badge-neutral"}`} style={{ fontSize: "0.7rem" }}>
                            {item.signal.isBuyNow ? item.signal.triggerType || "BUY" : "WAIT"}
                          </span>
                          {item.signal.regime && (
                            <span className="text-muted" style={{ fontSize: "0.6rem" }}>{item.signal.regime}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted" style={{ fontSize: "0.7rem" }}>No signal</span>
                      )}
                    </td>
                    <td>
                      {item.recommendation === "BUY" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ color: "var(--accent-green)", fontWeight: 700, fontSize: "0.85rem" }}>BUY</span>
                          {item.signal?.rrRatio != null && (
                            <span className="text-muted" style={{ fontSize: "0.6rem" }}>R:R {item.signal.rrRatio.toFixed(1)}</span>
                          )}
                        </div>
                      ) : item.recommendation === "SPIKED" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {item.spike.warnings.map((w, i) => (
                            <span key={i} className={styles.spikeWarning} data-severity={w.severity}>
                              {w.message}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: "var(--accent-yellow)", fontWeight: 600, fontSize: "0.8rem" }}>WAIT</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.dcaResidual}>
            <div className="flex-between">
              <span>Budget: {formatJPY(dcaPlan.budget)}</span>
              <span>Allocated: {formatJPY(dcaPlan.totalAllocated)}</span>
              <span style={{ fontWeight: 600 }}>Residual: {formatJPY(dcaPlan.residual)}</span>
              <span className="text-muted">USD/JPY: ¥{dcaPlan.usdJpyRate?.toFixed(2)}</span>
            </div>
            {dcaPlan.residual > 0 && (
              <div className="text-muted" style={{ marginTop: 6, fontSize: "0.8rem" }}>
                Residual is due to JP stock lot-size rounding (100-share lots). Consider adding to US positions or rolling over.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
