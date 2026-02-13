"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./EnhancedStockCard.module.css";

const VERDICT_CONFIG = {
  CONFIRMED: { bg: "rgba(16, 185, 129, 0.15)", color: "#10b981", border: "#10b981" },
  CAUTION: { bg: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", border: "#f59e0b" },
  AVOID: { bg: "rgba(239, 68, 68, 0.15)", color: "#ef4444", border: "#ef4444" },
};

function formatNum(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString();
}

function formatSector(s) {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreColor(v) {
  if (v == null) return "var(--text-muted)";
  const n = Number(v);
  if (n >= 7) return "var(--accent-green)";
  if (n >= 4) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

function rrColor(rr) {
  if (rr == null) return "var(--text-muted)";
  if (rr >= 2) return "var(--accent-green)";
  if (rr >= 1) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

function computeRR(price, stop, target) {
  if (!price || !stop || !target) return null;
  const p = Number(price), s = Number(stop), t = Number(target);
  const risk = Math.abs(p - s);
  const reward = Math.abs(t - p);
  if (risk === 0) return null;
  return (reward / risk).toFixed(1);
}

function confidenceColor(c) {
  if (c >= 70) return "var(--accent-green)";
  if (c >= 40) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

function cardBorderClass(stock, review) {
  if (review?.verdict === "AVOID") return styles.cardAvoid;
  if (review?.verdict === "CAUTION") return styles.cardCaution;
  if (stock.is_buy_now) return styles.cardBuy;
  return "";
}

export default function EnhancedStockCard({
  stock,
  review,
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
        ) : stock.is_buy_now ? (
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
        ) : null}
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
          <div className={styles.addPopup} ref={popupRef}>
            {addStatus === "success" ? (
              <div style={{ padding: 12, textAlign: "center", color: "var(--accent-green)", fontWeight: 600 }}>
                Added to portfolio!
              </div>
            ) : (
              <form onSubmit={onAddSubmit}>
                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: "0.85rem" }}>
                  Add {stock.ticker_code} to Portfolio
                </div>
                <div className={styles.addPopupGrid}>
                  <div>
                    <label>Entry Price</label>
                    <input
                      type="number"
                      value={addForm.entry_price}
                      onChange={(e) => setAddForm((f) => ({ ...f, entry_price: e.target.value }))}
                      required
                      step="any"
                    />
                  </div>
                  <div>
                    <label>Shares</label>
                    <input
                      type="number"
                      value={addForm.shares}
                      onChange={(e) => setAddForm((f) => ({ ...f, shares: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <label>Stop Loss</label>
                    <input
                      type="number"
                      value={addForm.initial_stop}
                      onChange={(e) => setAddForm((f) => ({ ...f, initial_stop: e.target.value }))}
                      step="any"
                    />
                  </div>
                  <div>
                    <label>Target</label>
                    <input
                      type="number"
                      value={addForm.price_target}
                      onChange={(e) => setAddForm((f) => ({ ...f, price_target: e.target.value }))}
                      step="any"
                    />
                  </div>
                  <div>
                    <label>Type</label>
                    <select
                      value={addForm.entry_kind}
                      onChange={(e) => setAddForm((f) => ({ ...f, entry_kind: e.target.value }))}
                    >
                      <option value="DIP">DIP</option>
                      <option value="BREAKOUT">BREAKOUT</option>
                      <option value="RETEST">RETEST</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </div>
                  <div>
                    <label>Date</label>
                    <input
                      type="date"
                      value={addForm.entry_date}
                      onChange={(e) => setAddForm((f) => ({ ...f, entry_date: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <label>Reason</label>
                  <input
                    type="text"
                    value={addForm.entry_reason}
                    onChange={(e) => setAddForm((f) => ({ ...f, entry_reason: e.target.value }))}
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={onAddCancel}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={addStatus === "loading"}
                  >
                    {addStatus === "loading" ? "Adding..." : "Add"}
                  </button>
                </div>
                {addStatus === "error" && (
                  <div style={{ color: "var(--accent-red)", fontSize: "0.78rem", marginTop: 6 }}>
                    Failed to add. Please try again.
                  </div>
                )}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
