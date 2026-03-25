import Link from "next/link";
import styles from "./TodaysReport.module.css";

const CLASSIFICATION_META = {
  DEEP_VALUE: { label: "Deep Value", color: "#22c55e", bg: "rgba(34, 197, 94, 0.15)" },
  QARP: { label: "QARP", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)" },
  DIVIDEND_COMPOUNDER: { label: "Div Compounder", color: "#a855f7", bg: "rgba(168, 85, 247, 0.15)" },
  ASSET_PLAY: { label: "Asset Play", color: "#eab308", bg: "rgba(234, 179, 8, 0.15)" },
  RECOVERY_VALUE: { label: "Recovery", color: "#f97316", bg: "rgba(249, 115, 22, 0.15)" },
};

function gradeColor(grade) {
  if (grade === "A") return "var(--accent-green)";
  if (grade === "B") return "var(--accent-blue)";
  if (grade === "C") return "var(--accent-yellow)";
  if (grade === "D") return "var(--accent-orange)";
  return "var(--accent-red)";
}

function gradeBg(grade) {
  if (grade === "A") return "rgba(34, 197, 94, 0.15)";
  if (grade === "B") return "rgba(59, 130, 246, 0.15)";
  if (grade === "C") return "rgba(234, 179, 8, 0.15)";
  if (grade === "D") return "rgba(249, 115, 22, 0.15)";
  return "rgba(239, 68, 68, 0.15)";
}

export default function ValuePlaysSection({ valuePlays }) {
  if (!valuePlays || valuePlays.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          Value Plays
          <span className={styles.sectionCount}>{valuePlays.length}</span>
        </div>
        <Link href="/value-plays" className={styles.viewAll}>View all →</Link>
      </div>

      {valuePlays.map((v) => {
        const score = Number(v.value_play_score) || 0;
        const cls = CLASSIFICATION_META[v.value_play_class] || { label: v.value_play_class || "-", color: "var(--text-muted)", bg: "rgba(148, 163, 184, 0.15)" };

        return (
          <div key={v.ticker_code} className={styles.compactRow}>
            <Link href={`/scanner/${v.ticker_code}?view=value-play`} className={styles.rowTicker}>
              {v.ticker_code}
            </Link>
            <span className={styles.rowName}>{v.short_name || ""}</span>
            <span
              style={{
                fontSize: "0.68rem",
                fontWeight: 700,
                background: gradeBg(v.value_play_grade),
                color: gradeColor(v.value_play_grade),
                padding: "1px 7px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {v.value_play_grade || "-"}
            </span>
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 500,
                background: cls.bg,
                color: cls.color,
                padding: "1px 6px",
                borderRadius: "var(--radius-sm)",
                whiteSpace: "nowrap",
              }}
            >
              {cls.label}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <div className={styles.scoreBar}>
                <div
                  className={styles.scoreBarFill}
                  style={{
                    width: `${score}%`,
                    background: score >= 70 ? "var(--accent-green)" : score >= 40 ? "var(--accent-yellow)" : "var(--accent-red)",
                  }}
                />
              </div>
              <span className={styles.rowMeta} style={{ color: "var(--text-secondary)" }}>
                {score}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
