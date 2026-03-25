"use client";

import { useState } from "react";
import { PriceChart, ScanHistoryChart } from "./Charts";
import AIAnalysisSection from "../../../components/stock/AIAnalysisSection";
import MLPredictionSection from "../../../components/stock/MLPredictionSection";
import ValuePlayDetail from "../../../components/stock/ValuePlayDetail";
import { formatNum } from "../../../lib/uiHelpers";

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

export default function StockDetailTabs({
  defaultView,
  scan,
  history,
  snapshot,
  news,
  prediction,
  recentNews,
  aiReview,
  tickerCode,
  valuePlayData,
  hasValuePlay,
}) {
  const [activeView, setActiveView] = useState(defaultView);

  return (
    <>
      {/* Tab Toggle — only shown when value play data exists */}
      {hasValuePlay && (
        <div style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border-primary)",
          marginBottom: 20,
        }}>
          <button
            onClick={() => setActiveView("swing-trade")}
            style={{
              padding: "10px 24px",
              background: "transparent",
              border: "none",
              borderBottom: activeView === "swing-trade"
                ? "2px solid var(--accent-blue)"
                : "2px solid transparent",
              color: activeView === "swing-trade" ? "var(--accent-blue)" : "var(--text-muted)",
              cursor: "pointer",
              fontWeight: activeView === "swing-trade" ? 600 : 400,
              fontSize: "0.9rem",
            }}
          >
            Swing Trade
          </button>
          <button
            onClick={() => setActiveView("value-play")}
            style={{
              padding: "10px 24px",
              background: "transparent",
              border: "none",
              borderBottom: activeView === "value-play"
                ? "2px solid var(--accent-purple, #a855f7)"
                : "2px solid transparent",
              color: activeView === "value-play" ? "var(--accent-purple, #a855f7)" : "var(--text-muted)",
              cursor: "pointer",
              fontWeight: activeView === "value-play" ? 600 : 400,
              fontSize: "0.9rem",
            }}
          >
            Value Play
          </button>
        </div>
      )}

      {/* ── Swing Trade View ── */}
      {activeView === "swing-trade" && (
        <>
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

            <MLPredictionSection
              tickerCode={tickerCode}
              initialPrediction={prediction}
              currentPrice={scan?.current_price}
            />
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
        </>
      )}

      {/* ── Value Play View ── */}
      {activeView === "value-play" && valuePlayData && (
        <ValuePlayDetail data={valuePlayData} scan={scan} />
      )}

      {/* ── Shared sections (both views) ── */}

      {/* AI Analysis */}
      <AIAnalysisSection tickerCode={tickerCode} initialReview={aiReview} />

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
