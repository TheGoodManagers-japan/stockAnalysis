import { query } from "../../../lib/db";
import Link from "next/link";
import PriceChart from "../../../components/stock/PriceChart";
import ScanHistoryChart from "../../../components/stock/ScanHistoryChart";

export const dynamic = "force-dynamic";

async function getStockDetail(tickerCode) {
  try {
    const [scanResult, history, snapshot, news, prediction, recentNews] = await Promise.all([
      query(
        `SELECT sr.*, t.short_name, t.sector
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
    ]);

    return {
      scan: scanResult.rows[0] || null,
      history: history.rows.reverse(),
      snapshot: snapshot.rows[0] || null,
      news: news.rows[0] || null,
      prediction: prediction.rows[0] || null,
      recentNews: recentNews.rows || [],
    };
  } catch {
    return { scan: null, history: [], snapshot: null, news: null, prediction: null };
  }
}

function formatNum(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString();
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
  const { scan, history, snapshot, news, prediction, recentNews } = await getStockDetail(tickerCode);

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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {scan?.sector && <span className="badge badge-neutral">{scan.sector.replace(/_/g, " ")}</span>}
            {scan?.tier && <span className={`badge badge-tier-${scan.tier}`}>Tier {scan.tier}</span>}
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
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
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

      {/* Scores + Entry Signal + ML Prediction */}
      <div className="grid-3 mb-lg">
        <div className="card">
          <div className="card-title mb-md">Analysis Scores</div>
          <ScoreRow label="Fundamental" value={scan?.fundamental_score} />
          <ScoreRow label="Valuation" value={scan?.valuation_score} />
          <ScoreRow label="Technical" value={scan?.technical_score} />
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
        <div className="card">
          <div className="card-title mb-md">ML Prediction (30d)</div>
          {prediction ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="flex-between">
                <span className="text-secondary">Predicted Max</span>
                <span className="text-mono" style={{ fontWeight: 600, color: "var(--accent-blue)" }}>
                  {Number(prediction.predicted_max_30d).toLocaleString()}
                </span>
              </div>
              <div className="flex-between">
                <span className="text-secondary">Expected Change</span>
                <span
                  className="text-mono"
                  style={{
                    fontWeight: 600,
                    color: Number(prediction.predicted_pct_change) >= 0 ? "var(--accent-green)" : "var(--accent-red)",
                  }}
                >
                  {Number(prediction.predicted_pct_change) >= 0 ? "+" : ""}
                  {Number(prediction.predicted_pct_change).toFixed(1)}%
                </span>
              </div>
              <div className="flex-between">
                <span className="text-secondary">Model</span>
                <span className="text-muted">{prediction.model_type?.toUpperCase() || "LSTM"}</span>
              </div>
              <div>
                <div className="flex-between mb-sm">
                  <span className="text-secondary">Confidence</span>
                  <span className="text-mono" style={{ fontSize: "0.85rem" }}>
                    {(Number(prediction.confidence) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="score-bar-track">
                  <div
                    className="score-bar-fill"
                    style={{
                      width: `${Number(prediction.confidence) * 100}%`,
                      background: "var(--accent-blue)",
                    }}
                  />
                </div>
              </div>
              <div className="text-muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>
                Prediction date: {String(prediction.prediction_date).split("T")[0]}
              </div>
            </div>
          ) : (
            <p className="text-muted">No prediction available yet.</p>
          )}
        </div>
      </div>

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
                      {n.title_ja || n.title}
                    </a>
                  ) : (
                    <span style={{ fontSize: "0.85rem" }}>{n.title_ja || n.title}</span>
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
