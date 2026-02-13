"use client";

import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import Link from "next/link";
import ScanPicker from "./ScanPicker";
import styles from "./ScannerTable.module.css";
import EnhancedStockCard from "./EnhancedStockCard";
import cardStyles from "./EnhancedStockCard.module.css";

const COLUMNS = [
  { key: "ticker_code", label: "Ticker", sortable: true },
  { key: "sector", label: "Sector", sortable: true },
  { key: "current_price", label: "Price", sortable: true, mono: true },
  { key: "tier", label: "Tier", sortable: true },
  { key: "is_buy_now", label: "Signal", sortable: true },
  { key: "short_term_score", label: "ST", sortable: true },
  { key: "long_term_score", label: "LT", sortable: true },
  { key: "stop_loss", label: "Stop", sortable: true, mono: true },
  { key: "price_target", label: "Target", sortable: true, mono: true },
  { key: "market_regime", label: "Regime", sortable: true },
  { key: "buy_now_reason", label: "Reason", sortable: false },
  { key: "ai_verdict", label: "AI", sortable: true },
];

const SECTORS = [
  "All",
  "automobiles_transportation_equipment",
  "banking",
  "commercial_wholesale_trade",
  "construction_materials",
  "electric_appliances_precision",
  "electric_power_gas",
  "financials_ex_banks",
  "foods",
  "it_services_others",
  "machinery",
  "pharmaceutical",
  "raw_materials_chemicals",
  "real_estate",
  "retail_trade",
  "steel_nonferrous_metals",
  "transportation_logistics",
];

const VERDICT_CONFIG = {
  CONFIRMED: {
    label: "CONFIRMED",
    bg: "rgba(16, 185, 129, 0.15)",
    color: "#10b981",
    border: "#10b981",
  },
  CAUTION: {
    label: "CAUTION",
    bg: "rgba(245, 158, 11, 0.15)",
    color: "#f59e0b",
    border: "#f59e0b",
  },
  AVOID: {
    label: "AVOID",
    bg: "rgba(239, 68, 68, 0.15)",
    color: "#ef4444",
    border: "#ef4444",
  },
};

function formatSector(s) {
  if (!s) return "-";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatNum(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString();
}

function deriveEntryKind(reason) {
  if (!reason) return "OTHER";
  const r = reason.toLowerCase();
  if (r.includes("dip")) return "DIP";
  if (r.includes("breakout")) return "BREAKOUT";
  if (r.includes("retest")) return "RETEST";
  return "OTHER";
}

function getReviewData(row, aiReviews) {
  // Client-fetched review takes priority over server-rendered
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

function confidenceColor(c) {
  if (c >= 70) return "var(--accent-green)";
  if (c >= 40) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

export default function ScannerTable({ results = [], isLive = false }) {
  const [viewMode, setViewMode] = useState("card");
  const [sortKey, setSortKey] = useState("tier");
  const [sortDir, setSortDir] = useState("asc");
  const [sectorFilter, setSectorFilter] = useState("All");
  const [buyOnly, setBuyOnly] = useState(false);
  const [search, setSearch] = useState("");

  // Add-to-portfolio state
  const [addingTicker, setAddingTicker] = useState(null);
  const [addForm, setAddForm] = useState({});
  const [addStatus, setAddStatus] = useState(null);
  const [addedTickers, setAddedTickers] = useState(new Set());
  const popupRef = useRef(null);

  // Scan picker state
  const [selectedScanId, setSelectedScanId] = useState(null);
  const [historicalResults, setHistoricalResults] = useState(null);
  const [loadingHistorical, setLoadingHistorical] = useState(false);

  // Live polling when scan is running
  const [liveResults, setLiveResults] = useState(null);
  const intervalRef = useRef(null);

  // AI review state
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [aiReviews, setAiReviews] = useState({});
  const [loadingAi, setLoadingAi] = useState(null);

  useEffect(() => {
    if (!isLive) {
      setLiveResults(null);
      return;
    }

    async function pollResults() {
      try {
        const res = await fetch("/api/scan");
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.results) {
          setLiveResults(data.results);
        }
        if (
          data.scan?.status === "completed" ||
          data.scan?.status === "failed"
        ) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } catch {
        // Silently retry
      }
    }

    pollResults();
    intervalRef.current = setInterval(pollResults, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isLive]);

  // Fetch historical scan when picker changes
  useEffect(() => {
    if (!selectedScanId) {
      setHistoricalResults(null);
      return;
    }
    let cancelled = false;
    async function fetchScan() {
      setLoadingHistorical(true);
      try {
        const res = await fetch(`/api/scan?scanId=${selectedScanId}`);
        const data = await res.json();
        if (!cancelled && data.success) setHistoricalResults(data.results);
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoadingHistorical(false);
      }
    }
    fetchScan();
    return () => { cancelled = true; };
  }, [selectedScanId]);

  // Close popup on outside click
  useEffect(() => {
    if (!addingTicker) return;
    function handleClick(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setAddingTicker(null);
        setAddStatus(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [addingTicker]);

  // Persist view mode preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem("scanner-view-mode");
      if (saved === "table" || saved === "card") setViewMode(saved);
    } catch {}
  }, []);

  function handleViewModeChange(mode) {
    setViewMode(mode);
    try { localStorage.setItem("scanner-view-mode", mode); } catch {}
  }

  // Priority: historical (picker) > live (polling) > server-rendered
  const activeResults = historicalResults || liveResults || results;

  const filtered = useMemo(() => {
    let data = [...activeResults];

    if (sectorFilter !== "All") {
      data = data.filter((r) => r.sector === sectorFilter);
    }
    if (buyOnly) {
      data = data.filter((r) => r.is_buy_now);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      data = data.filter(
        (r) =>
          r.ticker_code?.toLowerCase().includes(q) ||
          r.short_name?.toLowerCase().includes(q)
      );
    }

    data.sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      if (va == null) va = sortDir === "asc" ? Infinity : -Infinity;
      if (vb == null) vb = sortDir === "asc" ? Infinity : -Infinity;
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (typeof va === "boolean") { va = va ? 0 : 1; vb = vb ? 0 : 1; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  }, [activeResults, sortKey, sortDir, sectorFilter, buyOnly, search]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function openAddPopup(r) {
    setAddingTicker(r.ticker_code);
    setAddForm({
      ticker_code: r.ticker_code,
      entry_price: r.current_price || "",
      shares: "100",
      initial_stop: r.stop_loss || "",
      price_target: r.price_target || "",
      entry_kind: deriveEntryKind(r.buy_now_reason),
      entry_reason: r.buy_now_reason || "",
      entry_date: new Date().toISOString().split("T")[0],
    });
    setAddStatus(null);
  }

  async function handleAddToPortfolio(e) {
    e.preventDefault();
    setAddStatus("loading");
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker_code: addForm.ticker_code,
          entry_price: Number(addForm.entry_price),
          shares: Number(addForm.shares),
          initial_stop: addForm.initial_stop ? Number(addForm.initial_stop) : null,
          price_target: addForm.price_target ? Number(addForm.price_target) : null,
          entry_kind: addForm.entry_kind,
          entry_reason: addForm.entry_reason,
          entry_date: addForm.entry_date,
        }),
      });
      if (res.ok) {
        setAddStatus("success");
        setAddedTickers((prev) => new Set(prev).add(addForm.ticker_code));
        setTimeout(() => {
          setAddingTicker(null);
          setAddStatus(null);
        }, 1200);
      } else {
        setAddStatus("error");
      }
    } catch {
      setAddStatus("error");
    }
  }

  async function handleAiReview(ticker) {
    setLoadingAi(ticker);
    try {
      const res = await fetch(`/api/scan/ai-review?ticker=${ticker}`);
      const data = await res.json();
      if (data.success && data.reviews?.length > 0) {
        setAiReviews((prev) => ({ ...prev, [ticker]: data.reviews[0] }));
        setExpandedTicker(ticker);
      }
    } catch (err) {
      console.error("AI review failed:", err);
    } finally {
      setLoadingAi(null);
    }
  }

  function toggleExpand(ticker) {
    setExpandedTicker((prev) => (prev === ticker ? null : ticker));
  }

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
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === "card" ? styles.viewToggleActive : ""}`}
            onClick={() => handleViewModeChange("card")}
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
            onClick={() => handleViewModeChange("table")}
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

      {/* Card view */}
      {viewMode === "card" && (
        <div className={cardStyles.cardGrid}>
          {filtered.length === 0 ? (
            <div className="text-muted" style={{ gridColumn: "1 / -1", textAlign: "center", padding: 40 }}>
              No results found
            </div>
          ) : (
            filtered.map((r) => {
              const review = getReviewData(r, aiReviews);
              return (
                <EnhancedStockCard
                  key={r.ticker_code}
                  stock={r}
                  review={review}
                  isAdded={addedTickers.has(r.ticker_code)}
                  onAddClick={openAddPopup}
                  onAiReview={handleAiReview}
                  isAiLoading={loadingAi === r.ticker_code}
                  isAddingThis={addingTicker === r.ticker_code}
                  addForm={addForm}
                  setAddForm={setAddForm}
                  addStatus={addStatus}
                  onAddSubmit={handleAddToPortfolio}
                  onAddCancel={() => { setAddingTicker(null); setAddStatus(null); }}
                  popupRef={popupRef}
                />
              );
            })
          )}
        </div>
      )}

      {/* Table view */}
      {viewMode === "table" && (
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
                  {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
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
              filtered.map((r) => {
                const review = getReviewData(r, aiReviews);
                const verdict = review ? VERDICT_CONFIG[review.verdict] : null;
                const isExpanded = expandedTicker === r.ticker_code;
                const isLoadingThis = loadingAi === r.ticker_code;

                return (
                  <Fragment key={r.ticker_code}>
                    <tr
                      className={`${r.is_buy_now ? "buy-signal" : ""} ${styles.clickableRow}`}
                      style={{ position: "relative" }}
                    >
                      {/* Link overlay covering entire row */}
                      <Link
                        href={`/scanner/${r.ticker_code}`}
                        className={styles.rowLink}
                        aria-label={`View details for ${r.ticker_code}`}
                      />

                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>
                        <div style={{ fontWeight: 600, color: "var(--accent-blue)" }}>
                          {r.ticker_code}
                        </div>
                        {r.short_name && (
                          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                            {r.short_name}
                          </div>
                        )}
                      </td>
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none", fontSize: "0.78rem" }}>
                        {formatSector(r.sector)}
                      </td>
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }} className="text-mono">{formatNum(r.current_price)}</td>
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>
                        <span className={`badge badge-tier-${r.tier || 3}`}>
                          T{r.tier || "?"}
                        </span>
                      </td>
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>
                        {r.is_buy_now ? (
                          <span className="badge badge-buy">BUY</span>
                        ) : (
                          <span className="badge badge-neutral">-</span>
                        )}
                      </td>
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>{r.short_term_score ?? "-"}</td>
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>{r.long_term_score ?? "-"}</td>
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }} className="text-mono">{formatNum(r.stop_loss)}</td>
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }} className="text-mono">{formatNum(r.price_target)}</td>
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>
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
                          position: "relative",
                          zIndex: 2,
                          pointerEvents: "none",
                          whiteSpace: "normal",
                          maxWidth: 250,
                          fontSize: "0.78rem",
                        }}
                      >
                        {r.buy_now_reason || "-"}
                      </td>
                      {/* AI verdict column */}
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>
                        {verdict ? (
                          <button
                            className={styles.btnAiVerdict}
                            style={{
                              background: verdict.bg,
                              color: verdict.color,
                              borderColor: verdict.border,
                              pointerEvents: "auto",
                              position: "relative",
                              zIndex: 3,
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
                        ) : r.is_buy_now ? (
                          <button
                            className={styles.btnAiReview}
                            style={{
                              pointerEvents: "auto",
                              position: "relative",
                              zIndex: 3,
                            }}
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
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      {/* Add to Portfolio button */}
                      <td style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>
                        {addedTickers.has(r.ticker_code) ? (
                          <span style={{ color: "var(--accent-green)", fontSize: "1.1rem" }} title="Added to portfolio">
                            &#10003;
                          </span>
                        ) : (
                          <button
                            className={styles.btnAddPortfolio}
                            style={{
                              pointerEvents: "auto",
                              position: "relative",
                              zIndex: 3,
                            }}
                            title="Add to portfolio"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAddPopup(r);
                            }}
                          >
                            +
                          </button>
                        )}

                        {/* Add-to-portfolio popup */}
                        {addingTicker === r.ticker_code && (
                          <div className={styles.addPopup} ref={popupRef}>
                            {addStatus === "success" ? (
                              <div style={{ padding: 16, textAlign: "center", color: "var(--accent-green)", fontWeight: 600 }}>
                                Added to portfolio!
                              </div>
                            ) : (
                              <form onSubmit={handleAddToPortfolio}>
                                <div style={{ fontWeight: 600, marginBottom: 10, fontSize: "0.9rem" }}>
                                  Add {r.ticker_code} to Portfolio
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
                                <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => { setAddingTicker(null); setAddStatus(null); }}
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
      )}
    </>
  );
}
