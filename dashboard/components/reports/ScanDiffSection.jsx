"use client";

import { useState } from "react";
import Link from "next/link";
import ScanPicker from "../scanner/ScanPicker";
import styles from "./InsightsSection.module.css";
import { formatSector } from "../../lib/uiHelpers";

function DiffArrow({ a, b, improved }) {
  if (a == null && b == null) return <span className={styles.diffUnchanged}>-</span>;
  if (a === b) return <span className={styles.diffUnchanged}>{String(a)}</span>;
  const cls = improved ? styles.diffImproved : styles.diffDegraded;
  return (
    <span className={cls}>
      {a ?? "—"} → {b ?? "—"}
    </span>
  );
}

export default function ScanDiffSection() {
  const [scanA, setScanA] = useState(null);
  const [scanB, setScanB] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleCompare() {
    if (!scanA || !scanB) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reports/scan-diff?scanA=${scanA}&scanB=${scanB}`
      );
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || "Failed to compare scans");
      }
    } catch {
      setError("Failed to fetch diff");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {/* Picker row */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>Scan A (older)</div>
          <ScanPicker onScanChange={setScanA} currentScanId={scanA} />
        </div>
        <div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>Scan B (newer)</div>
          <ScanPicker onScanChange={setScanB} currentScanId={scanB} />
        </div>
        <button
          className="btn btn-primary"
          onClick={handleCompare}
          disabled={!scanA || !scanB || loading}
          style={{ alignSelf: "flex-end", marginBottom: 0 }}
        >
          {loading ? "Comparing..." : "Compare"}
        </button>
      </div>

      {error && (
        <div className="card" style={{ color: "var(--accent-red)" }}>{error}</div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid-4 mb-lg">
            <div className="card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-green)" }}>
                {data.summary.newBuys}
              </div>
              <div className="text-muted" style={{ fontSize: "0.8rem" }}>New Buys</div>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-red)" }}>
                {data.summary.lostBuys}
              </div>
              <div className="text-muted" style={{ fontSize: "0.8rem" }}>Lost Buys</div>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-yellow)" }}>
                {data.summary.tierChanges}
              </div>
              <div className="text-muted" style={{ fontSize: "0.8rem" }}>Tier Changes</div>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-purple)" }}>
                {data.summary.regimeShifts}
              </div>
              <div className="text-muted" style={{ fontSize: "0.8rem" }}>Regime Shifts</div>
            </div>
          </div>

          {/* Changes table */}
          {data.allChanges.length === 0 ? (
            <div className="card text-muted" style={{ textAlign: "center", padding: 40 }}>
              No changes between these two scans.
            </div>
          ) : (
            <div className="card">
              <div className="card-title mb-md">
                All Changes ({data.allChanges.length})
              </div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Sector</th>
                      <th>Signal</th>
                      <th>Tier</th>
                      <th>Regime</th>
                      <th>Price</th>
                      <th>Reason (B)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.allChanges.map((c) => (
                      <tr key={c.ticker}>
                        <td>
                          <Link
                            href={`/scanner/${c.ticker}`}
                            style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600 }}
                          >
                            {c.ticker}
                          </Link>
                          {c.name && (
                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                              {c.name}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: "0.78rem" }}>{formatSector(c.sector)}</td>
                        <td>
                          <DiffArrow
                            a={c.buyA ? "BUY" : "-"}
                            b={c.buyB ? "BUY" : "-"}
                            improved={c.buyB && !c.buyA}
                          />
                        </td>
                        <td>
                          <DiffArrow
                            a={c.tierA ? `T${c.tierA}` : null}
                            b={c.tierB ? `T${c.tierB}` : null}
                            improved={c.tierB < c.tierA}
                          />
                        </td>
                        <td>
                          <DiffArrow
                            a={c.regimeA}
                            b={c.regimeB}
                            improved={
                              ["STRONG_UP", "UP"].includes(c.regimeB) &&
                              !["STRONG_UP", "UP"].includes(c.regimeA)
                            }
                          />
                        </td>
                        <td style={{ fontFamily: "var(--font-mono)" }}>
                          {c.priceA && c.priceB ? (
                            <span className={c.priceB > c.priceA ? styles.diffImproved : c.priceB < c.priceA ? styles.diffDegraded : styles.diffUnchanged}>
                              {c.priceA.toLocaleString()} → {c.priceB.toLocaleString()}
                            </span>
                          ) : "-"}
                        </td>
                        <td style={{ fontSize: "0.78rem", maxWidth: 200, whiteSpace: "normal" }}>
                          {c.reasonB || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
