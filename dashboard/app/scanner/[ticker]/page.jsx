import { query } from "../../../lib/db";
import Link from "next/link";
import { PriceChart, ScanHistoryChart } from "./Charts";
import AIAnalysisSection from "../../../components/stock/AIAnalysisSection";
import MLPredictionSection from "../../../components/stock/MLPredictionSection";
import { formatNum, masterScoreColor } from "../../../lib/uiHelpers";

export const dynamic = "force-dynamic";

async function getStockDetail(tickerCode) {
  try {
    const [scanResult, history, snapshot, news, prediction, recentNews, aiReview] = await Promise.all([
      query(
        `SELECT sr.*, t.short_name, t.sector,
                sr.master_score,
                (sr.other_data_json->>'scoring_confidence')::numeric AS scoring_confidence,
                (sr.other_data_json->>'data_freshness') AS data_freshness,
                (sr.other_data_json->>'tier_trajectory') AS tier_trajectory,
                (sr.other_data_json->>'is_conflicted')::boolean AS is_conflicted,
                (sr.other_data_json->>'score_disagreement')::numeric AS score_disagreement,
                (sr.other_data_json->>'fundPctile')::int AS fund_pctile,
                (sr.other_data_json->>'valPctile')::int AS val_pctile,
                (sr.other_data_json->>'techPctile')::int AS tech_pctile,
                (sr.other_data_json->>'catalyst_score')::numeric AS catalyst_score,
                (sr.other_data_json->>'catalyst_reason') AS catalyst_reason
         FROM scan_results sr
         JOIN tickers t ON t.code = sr.ticker_code
         WHERE sr.ticker_code = $1
         ORDER BY sr.scan_date DESC LIMIT 1`,
        [tickerCode]
      ),
      query(
        `SELECT date, open, high, low, close, volume
         FROM price_history WHERE ticker_code = $1
         ORDER BY date DESC LIMIT 250`,
        [tickerCode]
      ),
      query(
        `SELECT * FROM stock_snapshots
         WHERE ticker_code = $1
         ORDER BY snapshot_date DESC LIMIT 1`,
        [tickerCode]
      ),
      query(
        `SELECT * FROM news_analysis_cache
         WHERE ticker_code = $1
         ORDER BY analysis_date DESC LIMIT 1`,
        [tickerCode]
      ),
      query(
        `SELECT * FROM predictions
         WHERE ticker_code = $1
         ORDER BY prediction_date DESC LIMIT 1`,
        [tickerCode]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT na.id, na.source, na.source_url, na.title, na.title_ja,
                na.published_at, na.sentiment, na.sentiment_score,
                na.impact_level, na.news_category, na.ai_summary
         FROM news_articles na
         JOIN news_article_tickers nat ON nat.article_id = na.id
         WHERE nat.ticker_code = $1 AND na.is_analyzed = TRUE
         ORDER BY na.published_at DESC
         LIMIT 10`,
        [tickerCode]
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT verdict, reason as verdict_reason, confidence, full_analysis
         FROM ai_reviews
         WHERE ticker_code = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [tickerCode]
      ).catch(() => ({ rows: [] })),
    ]);

    return {
      scan: scanResult.rows[0] || null,
      history: history.rows.reverse(),
      snapshot: snapshot.rows[0] || null,
      news: news.rows[0] || null,
      prediction: prediction.rows[0] || null,
      recentNews: recentNews.rows || [],
      aiReview: aiReview.rows[0] || null,
    };
  } catch {
    return { scan: null, history: [], snapshot: null, news: null, prediction: null, recentNews: [], aiReview: null };
  }
}


function ScoreRow({ label, value, max = 10 }) {
  const pct = value != null ? (Number(value) / max) * 100 : 0;
  const color =
    pct >= 70
      ? "var(--accent-green)"
      : pct >= 40
      ? "var(--accent-yellow)"
      : "var(--accent-red)";
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="flex-between mb-sm">
        <span className="text-secondary" style={{ fontSize: "0.8rem" }}>
          {label}
        </span>
        <span className="text-mono" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
          {value != null ? Number(value).toFixed(1) : "-"}
        </span>
      </div>
      <div className="score-bar-track">
        <div
          className="score-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default async function StockDetailPage({ params }) {
  const { ticker } = await params;
  const tickerCode = decodeURIComponent(ticker);
  const { scan, history, snapshot, news, prediction, recentNews, aiReview } = await getStockDetail(tickerCode);

  return (
    <>
      <div className="mb-md">
        <Link
          href="/scanner"
          style={{ color: "var(--accent-blue)", textDecoration: "none", fontSize: "0.85rem" }}
        >
          ← Back to Scanner
        </Link>
      </div>

      {/* Header */}
      <div className="flex-between mb-lg" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "var(--text-heading)", marginBottom: 4 }}>
            {tickerCode}
            {scan?.short_name && (
              <span style={{ fontWeight: 400, color: "var(--text-secondary)", marginLeft: 12, fontSize: "1rem" }}>
                {scan.short_name}
              </span>
            )}
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {scan?.sector && <span className="badge badge-neutral">{scan.sector.replace(/_/g, " ")}</span>}
            {scan?.tier && (
              <span className={`badge badge-tier-${scan.tier}`}>
                Tier {scan.tier}
                {scan.tier_trajectory && scan.tier_trajectory !== "stable" && (
                  <span style={{ marginLeft: 4, fontSize: "0.7rem" }}>
                    {scan.tier_trajectory === "improving" ? "\u25B2" : "\u25BC"}
                  </span>
                )}
              </span>
            )}
            {scan?.is_buy_now && <span className="badge badge-buy">BUY</span>}
            {scan?.market_regime && (
              <span
                className={`badge ${
                  scan.market_regime === "STRONG_UP" || scan.market_regime === "UP"
                    ? "badge-buy"
                    : scan.market_regime === "DOWN"
                    ? "badge-sell"
                    : "badge-neutral"
                }`}
              >
                {scan.market_regime}
              </span>
            )}
            {scan?.is_conflicted && (
              <span className="badge badge-sell" style={{ fontSize: "0.65rem" }}>
                CONFLICTED
              </span>
            )}
            {scan?.data_freshness && scan.data_freshness !== "fresh" && (
              <span className="badge badge-neutral" style={{ fontSize: "0.65rem", color: scan.data_freshness === "stale" ? "var(--accent-red)" : "var(--accent-yellow)" }}>
                {scan.data_freshness.toUpperCase()} DATA
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 16 }}>
          {scan?.master_score != null && (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                border: `3px solid ${masterScoreColor(scan.master_score)}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                background: "var(--bg-tertiary)",
              }}
              title={`Master Score: ${scan.master_score}/100`}
            >
              <span style={{ fontSize: "1.2rem", fontWeight: 800, fontFamily: "var(--font-mono)", color: masterScoreColor(scan.master_score) }}>
                {scan.master_score}
              </span>
              <span style={{ fontSize: "0.5rem", color: "var(--text-muted)" }}>SCORE</span>
            </div>
          )}
          <div>
            <div
              style={{
                fontSize: "1.8rem",
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
                color: "var(--text-heading)",
              }}
            >
              {formatNum(scan?.current_price)}
            </div>
            <div className="text-muted" style={{ fontSize: "0.8rem" }}>JPY</div>
          </div>
        </div>
      </div>

      {/* Scores + Entry Signal + ML Prediction */}
      <div className="grid-3 mb-lg">
        <div className="card">
          <div className="card-title mb-md">Analysis Scores</div>
          <ScoreRow label="Fundamental" value={scan?.fundamental_score} />
          {scan?.fund_pctile != null && (
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: -6, marginBottom: 8 }}>
              Top {100 - scan.fund_pctile}% of scanned stocks
            </div>
          )}
          <ScoreRow label="Valuation" value={scan?.valuation_score} />
          {scan?.val_pctile != null && (
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: -6, marginBottom: 8 }}>
              Top {100 - scan.val_pctile}% of scanned stocks
            </div>
          )}
          <ScoreRow label="Technical" value={scan?.technical_score} />
          {scan?.tech_pctile != null && (
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: -6, marginBottom: 8 }}>
              Top {100 - scan.tech_pctile}% of scanned stocks
            </div>
          )}
          {scan?.catalyst_score != null && (
            <>
              <ScoreRow label="Catalyst" value={scan.catalyst_score} />
              {scan.catalyst_reason && (
                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: -6, marginBottom: 8 }}>
                  {scan.catalyst_reason}
                </div>
              )}
            </>
          )}
          {scan?.scoring_confidence != null && (
            <div style={{ marginTop: 8, fontSize: "0.72rem", color: "var(--text-muted)", borderTop: "1px solid var(--border-primary)", paddingTop: 8 }}>
              Data confidence: {Math.round(scan.scoring_confidence * 100)}%
              {scan.score_disagreement != null && (
                <span style={{ marginLeft: 8 }}>
                  | Disagreement: {Number(scan.score_disagreement).toFixed(2)}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title mb-md">Entry Signal</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="flex-between">
              <span className="text-secondary">Signal</span>
              <span style={{ fontWeight: 600 }}>
                {scan?.is_buy_now ? <span className="text-green">BUY</span> : <span className="text-muted">WAIT</span>}
              </span>
            </div>
            <div className="flex-between">
              <span className="text-secondary">Trigger</span>
              <span>{scan?.trigger_type || "-"}</span>
            </div>
            <div className="flex-between">
              <span className="text-secondary">Stop Loss</span>
              <span className="text-mono text-red">{formatNum(scan?.stop_loss)}</span>
            </div>
            <div className="flex-between">
              <span className="text-secondary">Target</span>
              <span className="text-mono text-green">{formatNum(scan?.price_target)}</span>
            </div>
            <div className="flex-between">
              <span className="text-secondary">Limit Order</span>
              <span className="text-mono">{formatNum(scan?.limit_buy_order)}</span>
            </div>
            {scan?.buy_now_reason && (
              <div style={{ marginTop: 8, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {scan.buy_now_reason}
              </div>
            )}
          </div>
        </div>

        {/* ML Prediction */}
        <MLPredictionSection
          tickerCode={tickerCode}
          initialPrediction={prediction}
          currentPrice={scan?.current_price}
        />
      </div>

      {/* AI Analysis */}
      <AIAnalysisSection tickerCode={tickerCode} initialReview={aiReview} />

      {/* Sentiment & Management */}
      <div className="card mb-lg">
        <div className="card-title mb-md">Sentiment & Management</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          <div>
            <div className="text-secondary" style={{ fontSize: "0.8rem", marginBottom: 4 }}>Short-term</div>
            <div>
              {scan?.short_term_score ?? "-"}/7
              {scan?.short_term_bias && (
                <span className="text-muted" style={{ marginLeft: 6, fontSize: "0.78rem" }}>({scan.short_term_bias})</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-secondary" style={{ fontSize: "0.8rem", marginBottom: 4 }}>Long-term</div>
            <div>
              {scan?.long_term_score ?? "-"}/7
              {scan?.long_term_bias && (
                <span className="text-muted" style={{ marginLeft: 6, fontSize: "0.78rem" }}>({scan.long_term_bias})</span>
              )}
            </div>
          </div>
          {scan?.mgmt_signal_status && (
            <div>
              <div className="text-secondary" style={{ fontSize: "0.8rem", marginBottom: 4 }}>Management Signal</div>
              <span
                className={scan.mgmt_signal_status === "Hold" ? "text-yellow" : scan.mgmt_signal_status === "Sell Now" ? "text-red" : "text-green"}
                style={{ fontWeight: 600 }}
              >
                {scan.mgmt_signal_status}
              </span>
              {scan.mgmt_signal_reason && (
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>{scan.mgmt_signal_reason}</div>
              )}
            </div>
          )}
          {news && (
            <div>
              <div className="text-secondary" style={{ fontSize: "0.8rem", marginBottom: 4 }}>News</div>
              <span className={news.sentiment === "Bullish" ? "text-green" : news.sentiment === "Bearish" ? "text-red" : "text-muted"}>
                {news.sentiment} ({Number(news.sentiment_score).toFixed(2)})
              </span>
              {news.summary && (
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>{news.summary}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recent News */}
      {recentNews.length > 0 && (
        <div className="card mb-lg">
          <div className="card-title mb-md">Recent News</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recentNews.map((n) => (
              <div
                key={n.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "start",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border-primary)",
                }}
              >
                <div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    <span className="badge badge-source" data-source={n.source} style={{ fontSize: "0.65rem" }}>
                      {n.source}
                    </span>
                    {n.news_category && n.news_category !== "other" && (
                      <span className="badge badge-neutral" style={{ fontSize: "0.65rem" }}>{n.news_category}</span>
                    )}
                    <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                      {n.published_at ? new Date(n.published_at).toLocaleDateString("ja-JP") : ""}
                    </span>
                  </div>
                  {n.source_url ? (
                    <a href={n.source_url} target="_blank" rel="noopener noreferrer"
                       style={{ color: "var(--text-heading)", textDecoration: "none", fontSize: "0.85rem", fontWeight: 500 }}>
                      {n.title || n.title_ja}
                    </a>
                  ) : (
                    <span style={{ fontSize: "0.85rem" }}>{n.title || n.title_ja}</span>
                  )}
                  {n.ai_summary && (
                    <div className="text-muted" style={{ fontSize: "0.75rem", marginTop: 3 }}>{n.ai_summary}</div>
                  )}
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span className={`badge ${n.sentiment === "Bullish" ? "badge-buy" : n.sentiment === "Bearish" ? "badge-sell" : "badge-neutral"}`}>
                    {n.sentiment}
                  </span>
                  {n.impact_level && (
                    <div style={{ marginTop: 4 }}>
                      <span className={`badge ${n.impact_level === "high" ? "badge-sell" : n.impact_level === "medium" ? "badge-hold" : "badge-neutral"}`}
                            style={{ fontSize: "0.62rem" }}>
                        {n.impact_level}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fundamentals */}
      {snapshot && (
        <div className="card mb-lg">
          <div className="card-title mb-md">Fundamentals</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {[
              ["P/E", snapshot.pe_ratio],
              ["P/B", snapshot.pb_ratio],
              ["Div Yield", snapshot.dividend_yield ? `${(Number(snapshot.dividend_yield) * 100).toFixed(2)}%` : null],
              ["D/E Ratio", snapshot.debt_equity_ratio],
              ["EPS (TTM)", snapshot.eps_trailing],
              ["EPS (Fwd)", snapshot.eps_forward],
              ["52W High", snapshot.fifty_two_week_high],
              ["52W Low", snapshot.fifty_two_week_low],
              ["Market Cap", snapshot.market_cap ? `${(Number(snapshot.market_cap) / 1e9).toFixed(1)}B` : null],
              ["RSI(14)", snapshot.rsi_14],
              ["ATR(14)", snapshot.atr_14],
              ["MA50", snapshot.ma_50d],
              ["MA200", snapshot.ma_200d],
            ].map(([label, val]) => (
              <div key={label}>
                <div className="text-muted" style={{ fontSize: "0.72rem" }}>{label}</div>
                <div className="text-mono" style={{ fontSize: "0.9rem" }}>{val != null ? String(val) : "-"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price chart */}
      <div className="card mb-lg">
        <div className="card-title mb-md">Price History</div>
        {history.length === 0 ? (
          <div className="text-muted" style={{ padding: 40, textAlign: "center" }}>
            No price history cached yet. Run a scan to populate data.
          </div>
        ) : (
          <PriceChart history={history} scan={scan} />
        )}
      </div>

      {/* Score Evolution */}
      <div className="card mb-lg">
        <div className="card-title mb-md">Score Evolution Over Time</div>
        <ScanHistoryChart ticker={tickerCode} />
      </div>
    </>
  );
}
