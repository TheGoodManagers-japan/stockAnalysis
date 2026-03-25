"use client";

import { Fragment, useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ScanPicker from "./ScanPicker";
import styles from "./ScannerTable.module.css";
import EnhancedStockCard from "./EnhancedStockCard";
import cardStyles from "./EnhancedStockCard.module.css";
import AddToPortfolioPopup from "./AddToPortfolioPopup";
import NewsContextBadge from "../ui/NewsContextBadge";
import { VERDICT_CONFIG, formatNum, formatSector, confidenceColor, masterScoreColor } from "../../lib/uiHelpers";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useScannerSort } from "../../hooks/useScannerSort";
import { useScannerPolling } from "../../hooks/useScannerPolling";
import { useAddToPortfolio } from "../../hooks/useAddToPortfolio";
import { useAiReview } from "../../hooks/useAiReview";
import { useNewsContext } from "../../hooks/useNewsContext";
import MLErrorsPanel from "./MLErrorsPanel";

const COLUMNS = [
  { key: "ticker_code", label: "Ticker", sortable: true },
  { key: "sector", label: "Sector", sortable: true },
  { key: "current_price", label: "Price", sortable: true, mono: true },
  { key: "master_score", label: "Score", sortable: true },
  { key: "tier", label: "Tier", sortable: true },
  { key: "is_buy_now", label: "Signal", sortable: true },
  { key: "ml_confidence", label: "ML", sortable: true },
  { key: "short_term_score", label: "ST", sortable: true },
  { key: "long_term_score", label: "LT", sortable: true },
  { key: "stop_loss", label: "Stop", sortable: true, mono: true },
  { key: "price_target", label: "Target", sortable: true, mono: true },
  { key: "market_regime", label: "Regime", sortable: true },
  { key: "buy_now_reason", label: "Reason", sortable: false },
  { key: "ai_verdict", label: "AI", sortable: true },
  { key: "news", label: "News", sortable: true },
];

function getReviewData(row, aiReviews) {
  if (aiReviews[row.ticker_code]) return aiReviews[row.ticker_code];
  if (row.ai_verdict) {
    return {
      verdict: row.ai_verdict,
      verdict_reason: row.ai_reason,
      confidence: row.ai_confidence,
      ...(row.ai_full_analysis || {}),
    };
  }
  return null;
}

export default function ScannerTable({ results = [], isLive = false }) {
  const [viewMode, setViewMode] = useLocalStorage("scanner-view-mode", "card");
  const [activeTab, setActiveTab] = useLocalStorage("scanner-active-tab", "results");

  const {
    liveResults,
    selectedScanId,
    setSelectedScanId,
    historicalResults,
    loadingHistorical,
  } = useScannerPolling(isLive);

  // Priority: historical (picker) > live (polling) > server-rendered
  const activeResults = historicalResults || liveResults || results;

  const {
    filtered,
    sortKey,
    sortDir,
    handleSort,
    sectorFilter,
    setSectorFilter,
    buyOnly,
    setBuyOnly,
    liquidOnly,
    setLiquidOnly,
    search,
    setSearch,
    SECTORS,
  } = useScannerSort(activeResults);

  const {
    addingTicker,
    addForm,
    setAddForm,
    addStatus,
    addedTickers,
    popupRef,
    openAddPopup,
    handleAddToPortfolio,
    closePopup,
  } = useAddToPortfolio();

  const {
    expandedTicker,
    aiReviews,
    loadingAi,
    handleAiReview,
    toggleExpand,
  } = useAiReview();

  const router = useRouter();

  const handleRowClick = useCallback((tickerCode) => {
    router.push(`/scanner/${tickerCode}`);
  }, [router]);

  const tickerList = useMemo(
    () => activeResults.map((r) => r.ticker_code),
    [activeResults]
  );
  const newsContext = useNewsContext(tickerList);

  const reviewMap = useMemo(() => {
    const map = {};
    for (const r of filtered) {
      map[r.ticker_code] = getReviewData(r, aiReviews);
    }
    return map;
  }, [filtered, aiReviews]);

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  // Reset page when filters/sort change
  useEffect(() => setPage(1), [sortKey, sortDir, sectorFilter, buyOnly, liquidOnly, search]);
  const visible = filtered.slice(0, page * PAGE_SIZE);
  const hasMore = page * PAGE_SIZE < filtered.length;

  const mlErrors = useMemo(() => {
    return activeResults.filter(
      (r) => r.is_buy_now && (!r.predicted_max_5d || r.ml_skip_reason)
    );
  }, [activeResults]);

  const totalCols = COLUMNS.length + 1; // +1 for portfolio button column

  return (
    <>
      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <ScanPicker
          onScanChange={(scanId) => setSelectedScanId(scanId)}
          currentScanId={selectedScanId}
          onDelete={() => setSelectedScanId(null)}
        />
        <input
          type="text"
          placeholder="Search ticker..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
        >
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {s === "All" ? "All Sectors" : formatSector(s)}
            </option>
          ))}
        </select>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={buyOnly}
            onChange={(e) => setBuyOnly(e.target.checked)}
          />
          Buy signals only
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={liquidOnly}
            onChange={(e) => setLiquidOnly(e.target.checked)}
          />
          Liquid only
        </label>
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === "card" ? styles.viewToggleActive : ""}`}
            onClick={() => setViewMode("card")}
            title="Card view"
            aria-label="Card view"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="1" width="6" height="6" rx="1" />
              <rect x="9" y="1" width="6" height="6" rx="1" />
              <rect x="1" y="9" width="6" height="6" rx="1" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
            </svg>
          </button>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === "table" ? styles.viewToggleActive : ""}`}
            onClick={() => setViewMode("table")}
            title="Table view"
            aria-label="Table view"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="14" height="2" rx="1" />
              <rect x="1" y="7" width="14" height="2" rx="1" />
              <rect x="1" y="12" width="14" height="2" rx="1" />
            </svg>
          </button>
        </div>
        <span className="text-muted" style={{ marginLeft: "auto" }}>
          {filtered.length} results
          {isLive && !liveResults ? " (loading...)" : ""}
          {loadingHistorical ? " (loading scan...)" : ""}
          {viewMode === "card" && (
            <span className={styles.sortIndicator}>
              {" "}Sorted by: {COLUMNS.find(c => c.key === sortKey)?.label || sortKey} {sortDir === "asc" ? "\u25B2" : "\u25BC"}
            </span>
          )}
        </span>
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${activeTab === "results" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("results")}
        >
          Results
          <span className={`${styles.tabBadge} ${styles.tabBadgeDefault}`}>
            {filtered.length}
          </span>
        </button>
        <button
          className={`${styles.tab} ${activeTab === "errors" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("errors")}
        >
          ML Errors
          {mlErrors.length > 0 ? (
            <span className={`${styles.tabBadge} ${styles.tabBadgeError}`}>
              {mlErrors.length}
            </span>
          ) : (
            <span className={`${styles.tabBadge} ${styles.tabBadgeDefault}`}>0</span>
          )}
        </button>
      </div>

      {/* Card view */}
      {activeTab === "results" && viewMode === "card" && (
        <>
          <div className={cardStyles.cardGrid}>
            {filtered.length === 0 ? (
              <div className="text-muted" style={{ gridColumn: "1 / -1", textAlign: "center", padding: 40 }}>
                No results found
              </div>
            ) : (
              visible.map((r) => {
                return (
                  <EnhancedStockCard
                    key={r.ticker_code}
                    stock={r}
                    review={reviewMap[r.ticker_code]}
                    newsContext={newsContext[r.ticker_code]}
                    isAdded={addedTickers.has(r.ticker_code)}
                    onAddClick={openAddPopup}
                    onAiReview={handleAiReview}
                    isAiLoading={loadingAi === r.ticker_code}
                    isAddingThis={addingTicker === r.ticker_code}
                    addForm={addForm}
                    setAddForm={setAddForm}
                    addStatus={addStatus}
                    onAddSubmit={handleAddToPortfolio}
                    onAddCancel={closePopup}
                    popupRef={popupRef}
                  />
                );
              })
            )}
          </div>
          {hasMore && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <button
                onClick={() => setPage((p) => p + 1)}
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: 8,
                  padding: "10px 24px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                Load more ({filtered.length - page * PAGE_SIZE} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {/* Table view */}
      {activeTab === "results" && viewMode === "table" && (
      <>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={sortKey === col.key ? "sorted" : ""}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key && (sortDir === "asc" ? " \u25B2" : " \u25BC")}
                </th>
              ))}
              <th style={{ width: 44 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={totalCols}
                  className="text-muted"
                  style={{ textAlign: "center", padding: 40 }}
                >
                  No results found
                </td>
              </tr>
            ) : (
              visible.map((r) => {
                const review = reviewMap[r.ticker_code];
                const verdict = review ? VERDICT_CONFIG[review.verdict] : null;
                const isExpanded = expandedTicker === r.ticker_code;
                const isLoadingThis = loadingAi === r.ticker_code;

                return (
                  <Fragment key={r.ticker_code}>
                    <tr
                      className={`${r.is_buy_now ? "buy-signal" : ""} ${styles.clickableRow}`}
                      style={{ position: "relative", cursor: "pointer" }}
                      onClick={() => handleRowClick(r.ticker_code)}
                    >

                      <td>
                        <div style={{ fontWeight: 600, color: "var(--accent-blue)" }}>
                          {r.ticker_code}
                        </div>
                        {r.short_name && (
                          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                            {r.short_name}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: "0.78rem" }}>
                        {formatSector(r.sector)}
                      </td>
                      <td className="text-mono">{formatNum(r.current_price)}</td>
                      <td>
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: "0.85rem",
                            color: masterScoreColor(r.master_score),
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {r.master_score != null ? r.master_score : "-"}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-tier-${r.tier || 3}`}>
                          T{r.tier || "?"}
                        </span>
                      </td>
                      <td>
                        {r.is_buy_now ? (
                          <span className="badge badge-buy">BUY</span>
                        ) : (
                          <span className="badge badge-neutral">-</span>
                        )}
                      </td>
                      <td>
                        {r.is_buy_now && r.ml_signal_confidence != null ? (
                          <span
                            style={{
                              color: r.ml_signal_confidence > 0.65
                                ? "var(--accent-green)"
                                : r.ml_signal_confidence > 0.4
                                ? "var(--accent-yellow, #ffc107)"
                                : "var(--accent-red)",
                              fontWeight: 600,
                              fontSize: "0.82rem",
                            }}
                          >
                            {Math.round(r.ml_signal_confidence * 100)}%
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>{r.short_term_score ?? "-"}</td>
                      <td>{r.long_term_score ?? "-"}</td>
                      <td className="text-mono">{formatNum(r.stop_loss)}</td>
                      <td className="text-mono">{formatNum(r.price_target)}</td>
                      <td>
                        <span
                          className={`badge ${
                            r.market_regime === "STRONG_UP" || r.market_regime === "UP"
                              ? "badge-buy"
                              : r.market_regime === "DOWN"
                              ? "badge-sell"
                              : "badge-neutral"
                          }`}
                        >
                          {r.market_regime || "-"}
                        </span>
                      </td>
                      <td
                        style={{
                          whiteSpace: "normal",
                          maxWidth: 250,
                          fontSize: "0.78rem",
                        }}
                      >
                        {r.buy_now_reason || "-"}
                      </td>
                      {/* AI verdict column */}
                      <td>
                        {verdict ? (
                          <button
                            className={styles.btnAiVerdict}
                            style={{
                              background: verdict.bg,
                              color: verdict.color,
                              borderColor: verdict.border,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(r.ticker_code);
                            }}
                            title="Click to view AI report"
                          >
                            {verdict.label}
                            {review.confidence != null && (
                              <span style={{ fontSize: "0.65rem", opacity: 0.8, marginLeft: 4 }}>
                                {review.confidence}%
                              </span>
                            )}
                          </button>
                        ) : (
                          <button
                            className={styles.btnAiReview}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAiReview(r.ticker_code);
                            }}
                            disabled={isLoadingThis}
                          >
                            {isLoadingThis ? (
                              <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                            ) : (
                              "Analyze"
                            )}
                          </button>
                        )}
                      </td>
                      {/* News context column */}
                      <td>
                        <NewsContextBadge
                          articleCount={newsContext[r.ticker_code]?.article_count}
                          avgSentiment={newsContext[r.ticker_code]?.avg_sentiment}
                          maxImpact={newsContext[r.ticker_code]?.max_impact}
                          onWatchlist={newsContext[r.ticker_code]?.on_watchlist}
                          latestHeadline={newsContext[r.ticker_code]?.latest_headline}
                          compact
                        />
                      </td>
                      {/* Add to Portfolio button */}
                      <td style={{ position: "relative" }}>
                        {addedTickers.has(r.ticker_code) ? (
                          <span style={{ color: "var(--accent-green)", fontSize: "1.1rem" }} title="Added to portfolio">
                            &#10003;
                          </span>
                        ) : (
                          <button
                            className={styles.btnAddPortfolio}
                            title="Add to portfolio"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAddPopup(r);
                            }}
                          >
                            +
                          </button>
                        )}

                        {addingTicker === r.ticker_code && (
                          <AddToPortfolioPopup
                            tickerCode={r.ticker_code}
                            form={addForm}
                            setForm={setAddForm}
                            status={addStatus}
                            onSubmit={handleAddToPortfolio}
                            onClose={closePopup}
                            popupRef={popupRef}
                            styles={styles}
                          />
                        )}
                      </td>
                    </tr>

                    {/* Expanded AI review detail row */}
                    {isExpanded && review && (
                      <tr className={styles.expandedRow}>
                        <td colSpan={totalCols} style={{ padding: 0 }}>
                          <div className={styles.reviewContent}>
                            <div className={styles.reviewSection}>
                              <div className={styles.reviewSectionTitle}>Company</div>
                              <div className={styles.reviewSectionText}>
                                {review.company_description || "-"}
                              </div>
                            </div>
                            <div className={styles.reviewSection}>
                              <div className={styles.reviewSectionTitle}>Micro News</div>
                              <div className={styles.reviewSectionText}>
                                {review.news_summary || "No recent news"}
                              </div>
                            </div>
                            <div className={styles.reviewSection}>
                              <div className={styles.reviewSectionTitle}>Macro Context</div>
                              <div className={styles.reviewSectionText}>
                                {review.macro_context || "No macro data"}
                              </div>
                            </div>
                            <div className={styles.reviewSection}>
                              <div className={styles.reviewSectionTitle}>Earnings & Fundamentals</div>
                              <div className={styles.reviewSectionText}>
                                {review.earnings_status || "-"}
                              </div>
                            </div>
                            <div className={styles.reviewVerdictRow}>
                              <div>
                                <span
                                  className={styles.reviewVerdictBadge}
                                  style={{
                                    background: verdict.bg,
                                    color: verdict.color,
                                    borderColor: verdict.border,
                                  }}
                                >
                                  {verdict.label}
                                </span>
                                <span className={styles.reviewVerdictReason}>
                                  {review.verdict_reason || "-"}
                                </span>
                              </div>
                              {review.confidence != null && (
                                <div className={styles.confidenceBlock}>
                                  <span className={styles.confidenceLabel}>
                                    Confidence: {review.confidence}%
                                  </span>
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <button
            onClick={() => setPage((p) => p + 1)}
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-primary)",
              borderRadius: 8,
              padding: "10px 24px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Load more ({filtered.length - page * PAGE_SIZE} remaining)
          </button>
        </div>
      )}
      </>
      )}

      {/* ML Errors tab */}
      {activeTab === "errors" && (
        <MLErrorsPanel errors={mlErrors} />
      )}
    </>
  );
}
