import { query } from "../../lib/db";
import ScannerTable from "../../components/scanner/ScannerTable";

export const revalidate = 300;

async function getLatestScanResults() {
  try {
    // Get the latest scan — prefer completed scans, but show running scans
    // if they started recently (within 2 hours). Skip failed and stuck scans.
    const scanRun = await query(
      `SELECT scan_id, status, ticker_count, total_tickers, buy_count, current_ticker,
              started_at, finished_at
       FROM scan_runs
       WHERE status = 'completed'
          OR (status = 'running' AND started_at > NOW() - INTERVAL '2 hours')
       ORDER BY started_at DESC LIMIT 1`
    );
    if (scanRun.rows.length === 0) return { results: [], scanMeta: null };

    const scan = scanRun.rows[0];
    // Query scan results - handle case where ai_reviews table might not exist
    let results;
    try {
      results = await query(
        `SELECT sr.*, t.short_name, t.sector,
                ar.verdict AS ai_verdict, ar.reason AS ai_reason,
                ar.confidence AS ai_confidence, ar.full_analysis AS ai_full_analysis
         FROM scan_results sr
         LEFT JOIN tickers t ON t.code = sr.ticker_code
         LEFT JOIN ai_reviews ar ON ar.scan_id = sr.scan_id AND ar.ticker_code = sr.ticker_code
         WHERE sr.scan_id = $1
         ORDER BY sr.is_buy_now DESC, sr.tier ASC, sr.ticker_code ASC`,
        [scan.scan_id]
      );
    } catch (aiTableErr) {
      // If ai_reviews table doesn't exist, query without it
      console.warn("ai_reviews table not available, querying without AI data:", aiTableErr.message);
      results = await query(
        `SELECT sr.*, t.short_name, t.sector
         FROM scan_results sr
         LEFT JOIN tickers t ON t.code = sr.ticker_code
         WHERE sr.scan_id = $1
         ORDER BY sr.is_buy_now DESC, sr.tier ASC, sr.ticker_code ASC`,
        [scan.scan_id]
      );
    }

    return {
      results: results.rows,
      scanMeta: {
        scanId: scan.scan_id,
        status: scan.status,
        tickerCount: scan.ticker_count,
        totalTickers: scan.total_tickers,
        buyCount: scan.buy_count,
        currentTicker: scan.current_ticker,
        startedAt: scan.started_at,
        finishedAt: scan.finished_at,
      },
    };
  } catch (err) {
    console.error("Scanner page query failed:", err);
    return { results: [], scanMeta: null };
  }
}

export default async function ScannerPage() {
  const { results, scanMeta } = await getLatestScanResults();

  return (
    <>
      <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>
        Stock Scanner
        {scanMeta?.status === "running" && (
          <span
            style={{
              fontSize: "0.8rem",
              color: "var(--accent-yellow, #eab308)",
              marginLeft: 12,
              fontWeight: 400,
            }}
          >
            Scan in progress — {scanMeta.totalTickers ? Math.round((scanMeta.tickerCount / scanMeta.totalTickers) * 100) : 0}% ({scanMeta.tickerCount}/{scanMeta.totalTickers})
          </span>
        )}
      </h2>
      <ScannerTable
        results={results}
        isLive={scanMeta?.status === "running"}
      />
    </>
  );
}
