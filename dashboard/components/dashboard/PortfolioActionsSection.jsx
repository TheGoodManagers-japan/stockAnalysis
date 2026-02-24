import Link from "next/link";
import styles from "./TodaysReport.module.css";

export default function PortfolioActionsSection({ actions }) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          Portfolio Actions
          <span className={styles.sectionCount}>{actions.length}</span>
        </div>
        <Link href="/portfolio" className={styles.viewAll}>View all →</Link>
      </div>

      {actions.map((a) => {
        const entry = Number(a.entry_price);
        const current = Number(a.current_price);
        const pnlPct = entry > 0 ? ((current - entry) / entry * 100).toFixed(1) : null;
        const pnlColor = pnlPct >= 0 ? "var(--accent-green)" : "var(--accent-red)";

        const signalClass = a.mgmt_signal_status === "Sell Now"
          ? "badge-sell"
          : a.mgmt_signal_status === "Protect Profit"
            ? "badge-buy"
            : "badge-hold";

        return (
          <div key={a.ticker_code} className={styles.compactRow}>
            <Link href={`/scanner/${a.ticker_code}`} className={styles.rowTicker}>
              {a.ticker_code}
            </Link>
            <span className={styles.rowName}>{a.short_name || ""}</span>
            <span className={styles.rowPrice}>¥{current.toLocaleString()}</span>
            {pnlPct !== null && (
              <span className={styles.rowMeta} style={{ color: pnlColor }}>
                {pnlPct >= 0 ? "+" : ""}{pnlPct}%
              </span>
            )}
            <div className={styles.rowBadges}>
              <span className={`badge ${signalClass}`}>{a.mgmt_signal_status}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
