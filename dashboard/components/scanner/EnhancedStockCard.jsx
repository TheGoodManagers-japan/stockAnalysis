"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./EnhancedStockCard.module.css";
import AddToPortfolioPopup from "./AddToPortfolioPopup";
import NewsContextBadge from "../ui/NewsContextBadge";
import { VERDICT_CONFIG, formatNum, formatSector, scoreColor, rrColor, computeRR, confidenceColor } from "../../lib/uiHelpers";

function cardBorderClass(stock, review) {
  if (review?.verdict === "AVOID") return styles.cardAvoid;
  if (review?.verdict === "CAUTION") return styles.cardCaution;
  if (review?.verdict === "STRONG_BUY") return styles.cardStrongBuy;
  if (stock.is_buy_now) return styles.cardBuy;
  return "";
}

export default function EnhancedStockCard({
  stock,
  review,
  newsContext,
  isAdded,
  onAddClick,
  onAiReview,
  isAiLoading,
  // Add-to-portfolio popup props
  isAddingThis,
  addForm,
  setAddForm,
  addStatus,
  onAddSubmit,
  onAddCancel,
  popupRef,
}) {
  const [aiExpanded, setAiExpanded] = useState(false);
  const verdict = review ? VERDICT_CONFIG[review.verdict] : null;
  const rr = computeRR(stock.current_price, stock.stop_loss, stock.price_target);

  return (
    <div className={`${styles.card} ${cardBorderClass(stock, review)}`}>
      {/* Clickable overlay for navigation */}
      <Link
        href={`/scanner/${stock.ticker_code}`}
        className={styles.cardLink}
        aria-label={`View details for ${stock.ticker_code}`}
      />

      {/* Header */}
      <div className={`${styles.header} ${styles.cardInteractive}`} style={{ pointerEvents: "none" }}>
        <div className={styles.headerLeft}>
          <div className={styles.ticker}>{stock.ticker_code}</div>
          <div className={styles.name}>{stock.short_name || stock.ticker_code}</div>
          <div className={styles.sector}>{formatSector(stock.sector)}</div>
        </div>
        <div className={styles.badges}>
          <span className={`badge badge-tier-${stock.tier || 3}`}>
            T{stock.tier || "?"}
          </span>
          {stock.market_regime && (
            <span className={`badge ${
              stock.market_regime === "STRONG_UP" || stock.market_regime === "UP"
                ? "badge-buy"
                : stock.market_regime === "DOWN" ? "badge-sell" : "badge-neutral"
            }`}>
              {stock.market_regime}
            </span>
          )}
          {stock.is_buy_now && (
            <span className="badge badge-buy">BUY</span>
          )}
          {stock.is_buy_now && stock.other_data_json?.ml_signal_confidence != null && (
            <span
              className="badge"
              style={{
                background: stock.other_data_json.ml_signal_confidence > 0.65
                  ? "rgba(0,200,83,0.15)"
                  : stock.other_data_json.ml_signal_confidence > 0.4
                  ? "rgba(255,193,7,0.15)"
                  : "rgba(255,82,82,0.15)",
                color: stock.other_data_json.ml_signal_confidence > 0.65
                  ? "var(--accent-green)"
                  : stock.other_data_json.ml_signal_confidence > 0.4
                  ? "var(--accent-yellow, #ffc107)"
                  : "var(--accent-red)",
                border: "1px solid currentColor",
                fontSize: "0.65rem",
              }}
              title={`ML Signal Confidence: ${Math.round(stock.other_data_json.ml_signal_confidence * 100)}%`}
            >
              ML {Math.round(stock.other_data_json.ml_signal_confidence * 100)}%
            </span>
          )}
          {newsContext && newsContext.article_count > 0 && (
            <NewsContextBadge
              articleCount={newsContext.article_count}
              avgSentiment={newsContext.avg_sentiment}
              maxImpact={newsContext.max_impact}
              onWatchlist={newsContext.on_watchlist}
              latestHeadline={newsContext.latest_headline}
            />
          )}
        </div>
      </div>

      {/* Scores strip */}
      <div className={`${styles.scoresStrip} ${styles.cardInteractive}`} style={{ pointerEvents: "none" }}>
        <div className={styles.scoreItem}>
          <span className={styles.scoreLabel}>Fund</span>
          <span className={styles.scoreValue} style={{ color: scoreColor(stock.fundamental_score) }}>
            {stock.fundamental_score != null ? Number(stock.fundamental_score).toFixed(1) : "-"}
          </span>
        </div>
        <div className={styles.scoreItem}>
          <span className={styles.scoreLabel}>Val</span>
          <span className={styles.scoreValue} style={{ color: scoreColor(stock.valuation_score) }}>
            {stock.valuation_score != null ? Number(stock.valuation_score).toFixed(1) : "-"}
          </span>
        </div>
        <div className={styles.scoreItem}>
          <span className={styles.scoreLabel}>Tech</span>
          <span className={styles.scoreValue} style={{ color: scoreColor(stock.technical_score) }}>
            {stock.technical_score != null ? Number(stock.technical_score).toFixed(1) : "-"}
          </span>
        </div>
        <div className={styles.scoreItem}>
          <span className={styles.scoreLabel}>ST</span>
          <span className={styles.scoreValue} style={{ color: scoreColor(stock.short_term_score) }}>
            {stock.short_term_score ?? "-"}
          </span>
        </div>
        <div className={styles.scoreItem}>
          <span className={styles.scoreLabel}>LT</span>
          <span className={styles.scoreValue} style={{ color: scoreColor(stock.long_term_score) }}>
            {stock.long_term_score ?? "-"}
          </span>
        </div>
      </div>

      {/* Entry data grid */}
      <div className={`${styles.entryGrid} ${styles.cardInteractive}`} style={{ pointerEvents: "none" }}>
        <div className={styles.entryItem}>
          <span className={styles.entryIcon} aria-hidden>&#xA5;</span>
          <span className={styles.entryLabel}>Price</span>
          <span className={styles.entryValue}>{formatNum(stock.current_price)}</span>
        </div>
        <div className={styles.entryItem}>
          <span className={styles.entryIcon} style={{ color: "var(--accent-green)" }} aria-hidden>&#8599;</span>
          <span className={styles.entryLabel}>Target</span>
          <span className={styles.entryValue} style={{ color: "var(--accent-green)" }}>
            {formatNum(stock.price_target)}
          </span>
        </div>
        <div className={styles.entryItem}>
          <span className={styles.entryIcon} style={{ color: "var(--accent-red)" }} aria-hidden>&#9632;</span>
          <span className={styles.entryLabel}>Stop</span>
          <span className={styles.entryValue} style={{ color: "var(--accent-red)" }}>
            {formatNum(stock.stop_loss)}
          </span>
        </div>
        <div className={styles.entryItem}>
          <span className={styles.entryIcon} aria-hidden>&#8960;</span>
          <span className={styles.entryLabel}>R:R</span>
          <span className={styles.entryValue} style={{ color: rrColor(rr) }}>
            {rr != null ? `${rr}x` : "-"}
          </span>
        </div>
        {stock.trigger_type && (
          <div className={styles.entryFull}>
            <span className={styles.entryIcon} aria-hidden>&#9889;</span>
            <span className={`badge badge-buy`} style={{ fontSize: "0.7rem" }}>
              {stock.trigger_type}
            </span>
          </div>
        )}
        {stock.buy_now_reason && (
          <div className={styles.entryFull}>
            <span className={styles.entryIcon} aria-hidden>&#9998;</span>
            <span className={styles.reasonText}>{stock.buy_now_reason}</span>
          </div>
        )}
      </div>

      {/* AI section */}
      <div className={`${styles.aiSection} ${styles.cardInteractive}`}>
        {review ? (
          <>
            <div className={styles.aiRow}>
              <span
                className="badge"
                style={{
                  background: verdict?.bg,
                  color: verdict?.color,
                  borderColor: verdict?.border,
                  border: `1px solid ${verdict?.border}`,
                }}
              >
                {review.verdict}
                {review.confidence != null && (
                  <span style={{ fontSize: "0.62rem", opacity: 0.8, marginLeft: 4 }}>
                    {review.confidence}%
                  </span>
                )}
              </span>
              <span className={styles.aiReason}>
                {review.verdict_reason || "-"}
              </span>
              <button
                className={styles.aiExpandBtn}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAiExpanded(!aiExpanded); }}
                title={aiExpanded ? "Collapse" : "Expand AI details"}
              >
                {aiExpanded ? "\u25B2" : "\u25BC"}
              </button>
            </div>
            {aiExpanded && (
              <div className={styles.aiDetail}>
                <div className={styles.aiDetailSection}>
                  <div className={styles.aiDetailTitle}>Company</div>
                  <div className={styles.aiDetailText}>{review.company_description || "-"}</div>
                </div>
                <div className={styles.aiDetailSection}>
                  <div className={styles.aiDetailTitle}>News</div>
                  <div className={styles.aiDetailText}>{review.news_summary || "No recent news"}</div>
                </div>
                <div className={styles.aiDetailSection}>
                  <div className={styles.aiDetailTitle}>Macro</div>
                  <div className={styles.aiDetailText}>{review.macro_context || "No macro data"}</div>
                </div>
                <div className={styles.aiDetailSection}>
                  <div className={styles.aiDetailTitle}>Earnings</div>
                  <div className={styles.aiDetailText}>{review.earnings_status || "-"}</div>
                </div>
                {review.bull_points?.length > 0 && (
                  <div className={styles.aiDetailSection} style={{ borderLeft: "2px solid var(--accent-green)" }}>
                    <div className={styles.aiDetailTitle} style={{ color: "var(--accent-green)" }}>Bull Case</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.75rem", lineHeight: 1.5 }}>
                      {review.bull_points.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}
                {review.bear_points?.length > 0 && (
                  <div className={styles.aiDetailSection} style={{ borderLeft: "2px solid var(--accent-red)" }}>
                    <div className={styles.aiDetailTitle} style={{ color: "var(--accent-red)" }}>Bear Case</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.75rem", lineHeight: 1.5 }}>
                      {review.bear_points.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                )}
                {review.key_catalyst && (
                  <div className={styles.aiDetailSection}>
                    <div className={styles.aiDetailTitle}>Key Catalyst</div>
                    <div className={styles.aiDetailText}>{review.key_catalyst}</div>
                  </div>
                )}
                {review.watch_for && (
                  <div className={styles.aiDetailSection}>
                    <div className={styles.aiDetailTitle}>Watch For</div>
                    <div className={styles.aiDetailText}>{review.watch_for}</div>
                  </div>
                )}
                <div className={styles.aiVerdictRow}>
                  <div>
                    <span
                      className="badge"
                      style={{
                        background: verdict?.bg,
                        color: verdict?.color,
                        border: `1px solid ${verdict?.border}`,
                        marginRight: 8,
                      }}
                    >
                      {review.verdict}
                    </span>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-primary)" }}>
                      {review.verdict_reason || "-"}
                    </span>
                  </div>
                  {review.confidence != null && (
                    <div className={styles.confidenceBlock}>
                      <span className={styles.confidenceLabel}>{review.confidence}%</span>
                      <div className={styles.confidenceTrack}>
                        <div
                          className={styles.confidenceFill}
                          style={{
                            width: `${review.confidence}%`,
                            background: confidenceColor(review.confidence),
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <button
            className={styles.analyzeBtn}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAiReview(stock.ticker_code); }}
            disabled={isAiLoading}
          >
            {isAiLoading ? (
              <>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                Analyzing...
              </>
            ) : (
              "Analyze with AI"
            )}
          </button>
        )}
      </div>

      {/* Footer — add to portfolio */}
      <div className={`${styles.footer} ${styles.cardInteractive}`}>
        {isAdded ? (
          <span className={styles.addedCheck} title="Added to portfolio">&#10003;</span>
        ) : (
          <button
            className={styles.addBtn}
            title="Add to portfolio"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAddClick(stock); }}
          >
            +
          </button>
        )}

        {/* Add-to-portfolio popup */}
        {isAddingThis && (
          <AddToPortfolioPopup
            tickerCode={stock.ticker_code}
            form={addForm}
            setForm={setAddForm}
            status={addStatus}
            onSubmit={onAddSubmit}
            onClose={onAddCancel}
            popupRef={popupRef}
            styles={styles}
          />
        )}
      </div>
    </div>
  );
}
