import { query } from "../../lib/db";
import ScannerTable from "../../components/scanner/ScannerTable";

export const dynamic = "force-dynamic";

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
        `SELECT sr.ticker_code, sr.current_price, sr.fundamental_score, sr.valuation_score,
                sr.technical_score, sr.tier, sr.is_buy_now, sr.buy_now_reason, sr.trigger_type,
                sr.stop_loss, sr.price_target, sr.short_term_score, sr.long_term_score,
                sr.market_regime, sr.scan_date, sr.scan_id, sr.master_score,
                (sr.other_data_json->>'ml_signal_confidence')::numeric AS ml_signal_confidence,
                (sr.other_data_json->>'scoring_confidence')::numeric AS scoring_confidence,
                (sr.other_data_json->>'data_freshness') AS data_freshness,
                (sr.other_data_json->>'tier_trajectory') AS tier_trajectory,
                (sr.other_data_json->>'is_conflicted')::boolean AS is_conflicted,
                (sr.other_data_json->>'score_disagreement')::numeric AS score_disagreement,
                (sr.other_data_json->>'fundPctile')::int AS fund_pctile,
                (sr.other_data_json->>'valPctile')::int AS val_pctile,
                (sr.other_data_json->>'techPctile')::int AS tech_pctile,
                (sr.other_data_json->>'catalyst_score')::numeric AS catalyst_score,
                (sr.other_data_json->>'catalyst_reason') AS catalyst_reason,
                t.short_name, t.sector,
                ar.verdict AS ai_verdict, ar.reason AS ai_reason,
                ar.confidence AS ai_confidence, ar.full_analysis AS ai_full_analysis,
                p.predicted_max_5d, p.predicted_max_10d, p.predicted_max_20d, p.predicted_max_30d,
                p.predicted_pct_change, p.confidence AS ml_confidence, p.model_type AS ml_model_type,
                p.uncertainty_5d, p.uncertainty_10d, p.uncertainty_20d, p.uncertainty_30d,
                p.prediction_date AS ml_prediction_date, p.skip_reason AS ml_skip_reason,
                p.current_price AS ml_current_price
         FROM scan_results sr
         LEFT JOIN tickers t ON t.code = sr.ticker_code
         LEFT JOIN ai_reviews ar ON ar.scan_id = sr.scan_id AND ar.ticker_code = sr.ticker_code
         LEFT JOIN LATERAL (
           SELECT predicted_max_5d, predicted_max_10d, predicted_max_20d, predicted_max_30d,
                  predicted_pct_change, confidence, model_type,
                  uncertainty_5d, uncertainty_10d, uncertainty_20d, uncertainty_30d,
                  prediction_date, skip_reason, current_price
           FROM predictions pred
           WHERE pred.ticker_code = sr.ticker_code
           ORDER BY pred.prediction_date DESC LIMIT 1
         ) p ON true
         WHERE sr.scan_id = $1
         ORDER BY sr.master_score DESC NULLS LAST, sr.is_buy_now DESC, sr.tier ASC`,
        [scan.scan_id]
      );
    } catch (aiTableErr) {
      // If ai_reviews table doesn't exist, query without it
      console.warn("ai_reviews table not available, querying without AI data:", aiTableErr.message);
      results = await query(
        `SELECT sr.ticker_code, sr.current_price, sr.fundamental_score, sr.valuation_score,
                sr.technical_score, sr.tier, sr.is_buy_now, sr.buy_now_reason, sr.trigger_type,
                sr.stop_loss, sr.price_target, sr.short_term_score, sr.long_term_score,
                sr.market_regime, sr.scan_date, sr.scan_id, sr.master_score,
                (sr.other_data_json->>'ml_signal_confidence')::numeric AS ml_signal_confidence,
                (sr.other_data_json->>'scoring_confidence')::numeric AS scoring_confidence,
                (sr.other_data_json->>'data_freshness') AS data_freshness,
                (sr.other_data_json->>'tier_trajectory') AS tier_trajectory,
                (sr.other_data_json->>'is_conflicted')::boolean AS is_conflicted,
                (sr.other_data_json->>'score_disagreement')::numeric AS score_disagreement,
                (sr.other_data_json->>'fundPctile')::int AS fund_pctile,
                (sr.other_data_json->>'valPctile')::int AS val_pctile,
                (sr.other_data_json->>'techPctile')::int AS tech_pctile,
                (sr.other_data_json->>'catalyst_score')::numeric AS catalyst_score,
                (sr.other_data_json->>'catalyst_reason') AS catalyst_reason,
                t.short_name, t.sector,
                p.predicted_max_5d, p.predicted_max_10d, p.predicted_max_20d, p.predicted_max_30d,
                p.predicted_pct_change, p.confidence AS ml_confidence, p.model_type AS ml_model_type,
                p.uncertainty_5d, p.uncertainty_10d, p.uncertainty_20d, p.uncertainty_30d,
                p.prediction_date AS ml_prediction_date, p.skip_reason AS ml_skip_reason,
                p.current_price AS ml_current_price
         FROM scan_results sr
         LEFT JOIN tickers t ON t.code = sr.ticker_code
         LEFT JOIN LATERAL (
           SELECT predicted_max_5d, predicted_max_10d, predicted_max_20d, predicted_max_30d,
                  predicted_pct_change, confidence, model_type,
                  uncertainty_5d, uncertainty_10d, uncertainty_20d, uncertainty_30d,
                  prediction_date, skip_reason, current_price
           FROM predictions pred
           WHERE pred.ticker_code = sr.ticker_code
           ORDER BY pred.prediction_date DESC LIMIT 1
         ) p ON true
         WHERE sr.scan_id = $1
         ORDER BY sr.master_score DESC NULLS LAST, sr.is_buy_now DESC, sr.tier ASC`,
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
