import Link from "next/link";
import styles from "./TodaysReport.module.css";

function computeRR(price, stop, target) {
  if (!price || !stop || !target) return null;
  const p = Number(price), s = Number(stop), t = Number(target);
  const risk = Math.abs(p - s);
  const reward = Math.abs(t - p);
  if (risk === 0) return null;
  return (reward / risk).toFixed(1);
}

function rrColor(rr) {
  if (rr == null) return "var(--text-muted)";
  if (rr >= 2) return "var(--accent-green)";
  if (rr >= 1) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

export default function BuySignalsSection({ buySignals }) {
  if (!buySignals || buySignals.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          New Buy Signals
          <span className={styles.sectionCount}>{buySignals.length}</span>
        </div>
        <Link href="/scanner" className={styles.viewAll}>View all →</Link>
      </div>

      {buySignals.map((s) => {
        const rr = computeRR(s.current_price, s.stop_loss, s.price_target);
        const verdictConfig = {
          CONFIRMED: { label: "OK", bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
          CAUTION: { label: "!", bg: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" },
          AVOID: { label: "X", bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444" },
        };
        const vc = s.verdict ? verdictConfig[s.verdict] : null;

        return (
          <div key={s.ticker_code} className={styles.compactRow}>
            <Link href={`/scanner/${s.ticker_code}`} className={styles.rowTicker}>
              {s.ticker_code}
            </Link>
            <span className={styles.rowName}>{s.short_name || ""}</span>
            <span className={`badge badge-neutral`} style={{ fontSize: "0.65rem" }}>
              {s.trigger_type || "-"}
            </span>
            <span className={styles.rowPrice}>¥{Number(s.current_price).toLocaleString()}</span>
            {rr && (
              <span className={styles.rowMeta} style={{ color: rrColor(Number(rr)) }}>
                {rr}x
              </span>
            )}
            <div className={styles.rowBadges}>
              <span className={`badge badge-tier-${s.tier || 3}`} style={{ fontSize: "0.65rem" }}>
                T{s.tier || "-"}
              </span>
              <span className="badge badge-neutral" style={{ fontSize: "0.6rem" }}>
                {s.market_regime || "-"}
              </span>
              {vc && (
                <span
                  style={{
                    fontSize: "0.62rem",
                    fontWeight: 600,
                    background: vc.bg,
                    color: vc.color,
                    padding: "1px 6px",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  {vc.label}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
