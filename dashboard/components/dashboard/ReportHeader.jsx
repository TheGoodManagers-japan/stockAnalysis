import styles from "./TodaysReport.module.css";
import ErrorsCard from "./ErrorsCard";

function isScanStale(scan) {
  if (!scan?.started_at) return true;
  const scanDate = new Date(scan.started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  return scanDate !== today;
}

export default function ReportHeader({ scan, portfolio, buyCount, valuePlayCount, actionCount }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const stale = isScanStale(scan);

  const statusClass = scan?.status === "completed"
    ? styles.statusCompleted
    : scan?.status === "failed"
      ? styles.statusFailed
      : styles.statusRunning;

  const statusLabel = scan?.status === "completed"
    ? "Completed"
    : scan?.status === "failed"
      ? "Failed"
      : scan?.total_tickers
        ? `Running ${Math.round((scan.ticker_count / scan.total_tickers) * 100)}%`
        : "Running";

  const scanTime = scan?.started_at
    ? new Date(scan.started_at).toLocaleTimeString("en-US", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const pnlColor = portfolio?.unrealizedPct >= 0 ? "var(--accent-green)" : "var(--accent-red)";
  const pnlSign = portfolio?.unrealizedPct >= 0 ? "+" : "";

  return (
    <>
      <div className={styles.reportTitleRow}>
        <h2 className={styles.reportTitle}>Today&apos;s Report</h2>
        <span className={styles.reportDate}>{dateStr}</span>
      </div>

      {scan && (
        <div className={styles.scanMeta}>
          <span className={`${styles.statusBadge} ${statusClass}`}>{statusLabel}</span>
          {stale && <span className={`${styles.statusBadge} ${styles.statusStale}`}>Stale</span>}
          {scanTime && (
            <span style={{ color: "var(--text-muted)" }}>
              Last scan: {scanTime}
            </span>
          )}
        </div>
      )}

      {stale && scan && (
        <div className={styles.staleBanner}>
          No scan has been run today. Data shown is from{" "}
          {new Date(scan.started_at).toLocaleDateString("en-US", { timeZone: "Asia/Tokyo", month: "short", day: "numeric" })}.
        </div>
      )}

      <div className={styles.kpiStrip}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Scanned</div>
          <div className={styles.kpiValue} style={{ color: "var(--text-heading)" }}>
            {scan?.ticker_count || 0}
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Buy Signals</div>
          <div className={styles.kpiValue} style={{ color: buyCount > 0 ? "var(--accent-green)" : "var(--text-muted)" }}>
            {buyCount}
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Value Plays</div>
          <div className={styles.kpiValue} style={{ color: valuePlayCount > 0 ? "var(--accent-blue)" : "var(--text-muted)" }}>
            {valuePlayCount}
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Actions</div>
          <div className={styles.kpiValue} style={{ color: actionCount > 0 ? "var(--accent-yellow)" : "var(--text-muted)" }}>
            {actionCount}
          </div>
        </div>
        {portfolio ? (
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>Portfolio P&L</div>
            <div className={styles.kpiValue} style={{ color: pnlColor }}>
              {pnlSign}{portfolio.unrealizedPct}%
            </div>
          </div>
        ) : (
          <ErrorsCard
            errorCount={scan?.error_count || 0}
            errors={scan?.errors || []}
          />
        )}
      </div>
    </>
  );
}
