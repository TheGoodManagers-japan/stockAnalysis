import { query } from "../../lib/db.js";
import ValuePlaysTable from "../../components/value-plays/ValuePlaysTable";

export const dynamic = "force-dynamic";

export default async function ValuePlaysPage() {
  // Get latest completed full scan (prefer largest ticker_count to skip small test scans)
  const scanRun = await query(
    `SELECT * FROM scan_runs WHERE status = 'completed'
     ORDER BY ticker_count DESC, started_at DESC LIMIT 1`
  );

  let results = [];
  let scan = null;

  if (scanRun.rows.length > 0) {
    scan = scanRun.rows[0];
    const res = await query(
      `SELECT sr.*, t.short_name, t.sector
       FROM scan_results sr
       LEFT JOIN tickers t ON t.code = sr.ticker_code
       WHERE sr.scan_id = $1
         AND sr.is_value_candidate = true
       ORDER BY sr.value_play_score DESC NULLS LAST, sr.ticker_code ASC`,
      [scan.scan_id]
    );
    results = res.rows;
  }

  const scanDate = scan?.finished_at
    ? new Date(scan.finished_at).toLocaleDateString("ja-JP", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Value Plays</h1>
        <span
          className="badge"
          style={{
            background: "rgba(168, 85, 247, 0.15)",
            color: "#a855f7",
            fontSize: "0.82rem",
            fontWeight: 700,
          }}
        >
          {results.length}
        </span>
        {scanDate && (
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginLeft: "auto" }}>
            Last scan: {scanDate}
          </span>
        )}
      </div>

      <ValuePlaysTable results={results} />
    </>
  );
}
