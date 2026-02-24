import Link from "next/link";
import styles from "./TodaysReport.module.css";

export default function SpaceFundSection({ spaceFund }) {
  if (!spaceFund) return null;

  const pnlColor = spaceFund.unrealizedPnl >= 0 ? "var(--accent-green)" : "var(--accent-red)";
  const pnlSign = spaceFund.unrealizedPnl >= 0 ? "+" : "";
  const pctSign = spaceFund.unrealizedPnlPct >= 0 ? "+" : "";
  const driftColor = spaceFund.driftAlerts > 0 ? "var(--accent-yellow)" : "var(--text-muted)";

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Space Fund</div>
        <Link href="/space-fund" className={styles.viewAll}>View details →</Link>
      </div>

      <div className={styles.fundKpiRow}>
        <div className={styles.fundKpi}>
          <div className={styles.fundKpiLabel}>Total Value</div>
          <div className={styles.fundKpiValue} style={{ color: "var(--text-heading)" }}>
            ¥{spaceFund.totalValue.toLocaleString()}
          </div>
        </div>
        <div className={styles.fundKpi}>
          <div className={styles.fundKpiLabel}>Unrealized P&L</div>
          <div className={styles.fundKpiValue} style={{ color: pnlColor }}>
            {pnlSign}¥{Math.abs(spaceFund.unrealizedPnl).toLocaleString()}
          </div>
        </div>
        <div className={styles.fundKpi}>
          <div className={styles.fundKpiLabel}>Return</div>
          <div className={styles.fundKpiValue} style={{ color: pnlColor }}>
            {pctSign}{Number(spaceFund.unrealizedPnlPct).toFixed(1)}%
          </div>
        </div>
        <div className={styles.fundKpi}>
          <div className={styles.fundKpiLabel}>Drift Alerts</div>
          <div className={styles.fundKpiValue} style={{ color: driftColor }}>
            {spaceFund.driftAlerts}
          </div>
        </div>
      </div>
    </div>
  );
}
