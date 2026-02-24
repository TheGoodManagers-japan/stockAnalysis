import Link from "next/link";
import styles from "./TodaysReport.module.css";

export default function WatchlistSection({ watchlist }) {
  if (!watchlist || watchlist.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          Watchlist
          <span className={styles.sectionCount}>{watchlist.length}</span>
        </div>
        <Link href="/news" className={styles.viewAll}>View all →</Link>
      </div>

      <div className={styles.pillRow}>
        {watchlist.map((w) => {
          const sentiment = Number(w.avg_sentiment) || 0;
          const dotColor = sentiment > 0.2
            ? "var(--accent-green)"
            : sentiment < -0.1
              ? "var(--accent-red)"
              : "var(--accent-yellow)";

          return (
            <Link
              key={w.ticker_code}
              href={`/scanner/${w.ticker_code}`}
              className={styles.pill}
            >
              <span className={styles.pillDot} style={{ background: dotColor }} />
              <span className={styles.pillTicker}>{w.ticker_code}</span>
              <span className={styles.pillScore}>{Number(w.composite_score).toFixed(2)}</span>
              {w.max_impact === "high" && (
                <span style={{ fontSize: "0.6rem", color: "var(--accent-red)", fontWeight: 700 }}>!</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
