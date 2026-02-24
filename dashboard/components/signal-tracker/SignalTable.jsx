"use client";

import { useState } from "react";
import styles from "./SignalTracker.module.css";

function StatusBadge({ status }) {
  const cls =
    status === "OPEN"
      ? styles.badgeOpen
      : status === "WIN"
        ? styles.badgeWin
        : status === "LOSS"
          ? styles.badgeLoss
          : styles.badgeExpired;
  return <span className={`${styles.badge} ${cls}`}>{status}</span>;
}

function formatPrice(price, source) {
  if (price == null) return "—";
  const n = Number(price);
  if (!Number.isFinite(n)) return "—";
  // JP stocks: no decimals. US stocks: 2 decimals.
  return source === "space_fund" ? `$${n.toFixed(2)}` : `¥${Math.round(n).toLocaleString()}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function holdingDays(entryDate, exitDate) {
  if (!entryDate) return "—";
  const start = new Date(entryDate);
  const end = exitDate ? new Date(exitDate) : new Date();
  const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return `${days}d`;
}

export default function SignalTable({ trades, source }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [triggerFilter, setTriggerFilter] = useState("all");

  // Get unique trigger types for filter dropdown
  const triggerTypes = [...new Set(trades.map((t) => t.trigger_type).filter(Boolean))].sort();

  const filtered = trades.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (triggerFilter !== "all" && t.trigger_type !== triggerFilter) return false;
    return true;
  });

  if (trades.length === 0) {
    const sourceLabel =
      source === "scanner"
        ? "scanner"
        : source === "value_play"
          ? "value play"
          : "space fund";
    return (
      <div className={styles.emptyState}>
        No {sourceLabel} signals recorded yet.
      </div>
    );
  }

  return (
    <div>
      <div className={styles.filterBar}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="WIN">Win</option>
          <option value="LOSS">Loss</option>
          <option value="EXPIRED">Expired</option>
        </select>
        {triggerTypes.length > 1 && (
          <select value={triggerFilter} onChange={(e) => setTriggerFilter(e.target.value)}>
            <option value="all">All Triggers</option>
            {triggerTypes.map((tt) => (
              <option key={tt} value={tt}>
                {tt}
              </option>
            ))}
          </select>
        )}
        <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
          {filtered.length} trade{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Name</th>
              <th>Entry Date</th>
              <th>Entry</th>
              <th>Stop</th>
              <th>Target</th>
              <th>Status</th>
              <th>P&L</th>
              <th>R</th>
              <th>Days</th>
              <th>Trigger</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const pnl = t.pnl_pct != null ? Number(t.pnl_pct) : null;
              const rMul = t.r_multiple != null ? Number(t.r_multiple) : null;
              return (
                <tr key={t.id}>
                  <td className={styles.ticker}>{t.ticker_code}</td>
                  <td>{t.short_name || "—"}</td>
                  <td>{formatDate(t.entry_date)}</td>
                  <td>{formatPrice(t.entry_price, t.source)}</td>
                  <td>{formatPrice(t.stop_loss, t.source)}</td>
                  <td>{formatPrice(t.price_target, t.source)}</td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td className={pnl > 0 ? styles.positive : pnl < 0 ? styles.negative : ""}>
                    {pnl != null ? `${pnl > 0 ? "+" : ""}${pnl.toFixed(1)}%` : "—"}
                  </td>
                  <td className={rMul > 0 ? styles.positive : rMul < 0 ? styles.negative : ""}>
                    {rMul != null ? `${rMul.toFixed(2)}R` : "—"}
                  </td>
                  <td>{holdingDays(t.entry_date, t.exit_date)}</td>
                  <td>
                    {t.trigger_type ? (
                      <span className={styles.triggerBadge}>{t.trigger_type}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
