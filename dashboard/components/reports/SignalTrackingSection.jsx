"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import styles from "./InsightsSection.module.css";
import { formatNum, formatDate } from "../../lib/uiHelpers";

function OutcomeBadge({ outcome }) {
  const map = {
    target_hit: { label: "Target Hit", cls: "badge-buy" },
    stop_hit: { label: "Stop Hit", cls: "badge-sell" },
    open_profit: { label: "Open (+)", cls: "badge-hold" },
    open_loss: { label: "Open (-)", cls: "badge-neutral" },
    no_data: { label: "No Data", cls: "badge-neutral" },
  };
  const { label, cls } = map[outcome] || map.no_data;
  return <span className={`badge ${cls}`}>{label}</span>;
}

function WinRateCell({ rate, total }) {
  if (rate == null || total < 3) return <td className={styles.matrixCell}>—</td>;
  const cls = rate >= 60 ? styles.winHigh : rate >= 40 ? styles.winMid : styles.winLow;
  return (
    <td className={`${styles.matrixCell} ${cls}`}>
      {rate}% <span style={{ fontSize: "0.7rem", opacity: 0.7 }}>({total})</span>
    </td>
  );
}

export default function SignalTrackingSection({ days }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [sortKey, setSortKey] = useState("scanDate");
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => {
    setLoading(true);
    async function fetchData() {
      try {
        const res = await fetch(`/api/reports/signal-tracking?days=${days}`);
        const json = await res.json();
        if (json.success) setData(json);
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [days]);

  const filteredSignals = useMemo(() => {
    if (!data) return [];
    let list = data.signals;
    if (outcomeFilter !== "all") {
      list = list.filter((s) => s.outcome === outcomeFilter);
    }
    list = [...list].sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [data, outcomeFilter, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>;
  }

  if (!data) {
    return <div className="card text-muted">No signal tracking data available. Run scans first.</div>;
  }

  const { aggregates } = data;
  const triggerTypes = ["DIP", "BREAKOUT", "RETEST", "RECLAIM", "INSIDE"];
  const regimes = ["STRONG_UP", "UP", "RANGE", "DOWN"];

  return (
    <div>
      {/* Aggregate cards */}
      <div className="grid-4 mb-lg">
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-blue)" }}>
            {aggregates.total}
          </div>
          <div className="text-muted" style={{ fontSize: "0.8rem" }}>Total Signals</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-green)" }}>
            {aggregates.targetHit}
            <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "var(--text-secondary)" }}>
              {" "}({aggregates.winRate != null ? `${aggregates.winRate}%` : "—"})
            </span>
          </div>
          <div className="text-muted" style={{ fontSize: "0.8rem" }}>Targets Hit (Win Rate)</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-red)" }}>
            {aggregates.stopHit}
          </div>
          <div className="text-muted" style={{ fontSize: "0.8rem" }}>Stops Hit</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--accent-yellow)" }}>
            {aggregates.openProfit + aggregates.openLoss}
          </div>
          <div className="text-muted" style={{ fontSize: "0.8rem" }}>Still Open</div>
        </div>
      </div>

      {/* Win Rate Matrix: trigger x regime */}
      <div className="card mb-lg">
        <div className="card-title mb-md">Win Rate: Trigger Type x Regime</div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Trigger \ Regime</th>
                {regimes.map((r) => <th key={r}>{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {triggerTypes.map((trigger) => {
                // Compute per-cell from signals
                return (
                  <tr key={trigger}>
                    <td style={{ fontWeight: 600 }}>{trigger}</td>
                    {regimes.map((regime) => {
                      const matching = data.signals.filter(
                        (s) => s.triggerType === trigger && s.regime === regime &&
                          (s.outcome === "target_hit" || s.outcome === "stop_hit")
                      );
                      const wins = matching.filter((s) => s.outcome === "target_hit").length;
                      const total = matching.length;
                      const rate = total >= 3
                        ? Math.round((wins / total) * 1000) / 10
                        : null;
                      return <WinRateCell key={regime} rate={rate} total={total} />;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-muted" style={{ fontSize: "0.75rem", marginTop: 8 }}>
          Cells with fewer than 3 resolved signals show "—". Green = 60%+, Yellow = 40-60%, Red = &lt;40%.
        </div>
      </div>

      {/* Signal list with filtering */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-title">Signal History ({filteredSignals.length})</div>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "6px",
              padding: "5px 8px",
              fontSize: "0.8rem",
              fontFamily: "inherit",
            }}
          >
            <option value="all">All Outcomes</option>
            <option value="target_hit">Target Hit</option>
            <option value="stop_hit">Stop Hit</option>
            <option value="open_profit">Open (+)</option>
            <option value="open_loss">Open (-)</option>
          </select>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th onClick={() => handleSort("scanDate")} style={{ cursor: "pointer" }}>
                  Date{sortKey === "scanDate" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
                <th onClick={() => handleSort("ticker")} style={{ cursor: "pointer" }}>
                  Ticker{sortKey === "ticker" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
                <th>Trigger</th>
                <th>Regime</th>
                <th>Tier</th>
                <th>Entry</th>
                <th>Stop</th>
                <th>Target</th>
                <th>Max High</th>
                <th onClick={() => handleSort("outcome")} style={{ cursor: "pointer" }}>
                  Outcome{sortKey === "outcome" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-muted" style={{ textAlign: "center", padding: 40 }}>
                    No signals found for this period.
                  </td>
                </tr>
              ) : (
                filteredSignals.slice(0, 200).map((s, i) => (
                  <tr key={`${s.ticker}-${s.scanDate}-${i}`}>
                    <td style={{ fontSize: "0.78rem" }}>{formatDate(s.scanDate)}</td>
                    <td>
                      <Link
                        href={`/scanner/${s.ticker}`}
                        style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600 }}
                      >
                        {s.ticker}
                      </Link>
                    </td>
                    <td><span className="badge badge-neutral">{s.triggerType || "?"}</span></td>
                    <td>
                      <span className={`badge ${
                        s.regime === "STRONG_UP" || s.regime === "UP" ? "badge-buy"
                        : s.regime === "DOWN" ? "badge-sell" : "badge-neutral"
                      }`}>{s.regime || "-"}</span>
                    </td>
                    <td><span className={`badge badge-tier-${s.tier || 3}`}>T{s.tier || "?"}</span></td>
                    <td className="text-mono">{formatNum(s.signalPrice)}</td>
                    <td className="text-mono">{formatNum(s.stopLoss)}</td>
                    <td className="text-mono">{formatNum(s.priceTarget)}</td>
                    <td className="text-mono">{formatNum(s.maxHigh30d)}</td>
                    <td><OutcomeBadge outcome={s.outcome} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
