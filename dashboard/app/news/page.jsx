"use client";

import { useState, useEffect, useCallback } from "react";
import { reportError } from "../../lib/reportError";
import DailyReport from "../../components/news/DailyReport";
import NewsFilters from "../../components/news/NewsFilters";
import NewsTimeline from "../../components/news/NewsTimeline";
import NewsWatchlist from "../../components/news/NewsWatchlist";
import { useNewsActions } from "../../hooks/useNewsActions";

export default function NewsPage() {
  const [articles, setArticles] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [stats, setStats] = useState({});
  const [dailyReport, setDailyReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [filters, setFilters] = useState({ source: "", sentiment: "", impact: "", ticker: "" });
  const limit = 30;

  const fetchNews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.source) params.set("source", filters.source);
      if (filters.sentiment) params.set("sentiment", filters.sentiment);
      if (filters.impact) params.set("impact", filters.impact);
      if (filters.ticker) params.set("ticker", filters.ticker);
      params.set("page", page);
      params.set("limit", limit);
      params.set("analyzed", "false");
      const res = await fetch(`/api/news?${params}`);
      const json = await res.json();
      if (json.success) { setArticles(json.articles || []); setTotal(json.total || 0); setStats(json.stats || {}); }
    } catch (err) { reportError("page/news", err, { action: "fetchNews" }); }
    finally { setLoading(false); }
  }, [filters.source, filters.sentiment, filters.impact, filters.ticker, page]);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/news/watchlist");
      const json = await res.json();
      if (json.success) setWatchlist(json.watchlist || []);
    } catch (err) { reportError("page/news", err, { action: "fetchWatchlist" }); }
  }, []);

  const fetchDailyReport = useCallback(async () => {
    try {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
      const res = await fetch(`/api/news/daily-report?date=${today}`);
      const json = await res.json();
      if (json.success && !json.empty) setDailyReport(json);
    } catch (err) { reportError("page/news", err, { action: "fetchDailyReport" }); }
  }, []);

  async function generateDailyReport() {
    setGeneratingReport(true);
    try {
      const res = await fetch("/api/news/daily-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const json = await res.json();
      if (json.success && !json.empty) setDailyReport(json);
    } catch (err) { reportError("page/news", err, { action: "generateDailyReport" }); }
    finally { setGeneratingReport(false); }
  }

  useEffect(() => { fetchNews(); fetchWatchlist(); fetchDailyReport(); }, [fetchNews, fetchWatchlist, fetchDailyReport]);

  const onRefresh = useCallback(async () => { await fetchNews(); await fetchWatchlist(); }, [fetchNews, fetchWatchlist]);
  const { fetching, analyzing, analyzeProgress, setAnalyzeProgress, handleFetchAll, handleAnalyze } = useNewsActions(onRefresh);

  async function onAnalyze(opts) {
    const count = await handleAnalyze(opts);
    if (count > 0) {
      setAnalyzeProgress("Generating daily report...");
      await generateDailyReport();
    }
  }

  const totalPages = Math.ceil(total / limit);

  function handleFilterChange(field, value) { setFilters(f => ({ ...f, [field]: value })); setPage(1); }
  function handleClearFilters() { setFilters({ source: "", sentiment: "", impact: "", ticker: "" }); setPage(1); }

  return (
    <>
      <div className="flex-between mb-lg">
        <h2 style={{ color: "var(--text-heading)" }}>News Feed</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={handleFetchAll} disabled={fetching}>
            {fetching ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Fetching...</> : "Fetch All Sources"}
          </button>
          <button className="btn btn-primary" onClick={() => onAnalyze({ all: true })} disabled={analyzing}>
            {analyzing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> {analyzeProgress || "Analyzing..."}</> : "Analyze All"}
          </button>
          <button className="btn btn-secondary" onClick={() => onAnalyze({ all: true, reanalyze: true })} disabled={analyzing} title="Re-analyze articles missing ticker associations">
            {analyzing ? null : "Re-analyze"}
          </button>
        </div>
      </div>

      <div className="grid-4 mb-lg">
        <div className="card">
          <div className="card-subtitle">Today</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--text-heading)" }}>{stats.today_count || 0}</div>
          <div className="card-subtitle" style={{ marginTop: 4 }}>articles</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Sentiment</div>
          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
            <span style={{ color: "var(--accent-green)", fontWeight: 700 }}>{stats.bullish_count || 0}</span>
            <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>{stats.neutral_count || 0}</span>
            <span style={{ color: "var(--accent-red)", fontWeight: 700 }}>{stats.bearish_count || 0}</span>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 2 }}>
            <span className="card-subtitle">Bull</span>
            <span className="card-subtitle">Neut</span>
            <span className="card-subtitle">Bear</span>
          </div>
        </div>
        <div className="card">
          <div className="card-subtitle">High Impact</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--accent-orange)" }}>{stats.high_impact_count || 0}</div>
        </div>
        <div className="card">
          <div className="card-subtitle">Unanalyzed</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: stats.unanalyzed_count > 0 ? "var(--accent-yellow)" : "var(--text-heading)" }}>{stats.unanalyzed_count || 0}</div>
        </div>
      </div>

      <DailyReport report={dailyReport} onRegenerate={generateDailyReport} isGenerating={generatingReport} />
      <NewsFilters filters={filters} onFilterChange={handleFilterChange} onClear={handleClearFilters} />

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <NewsTimeline articles={articles} loading={loading} page={page} totalPages={totalPages} onPageChange={setPage} />
        <NewsWatchlist watchlist={watchlist} />
      </div>
    </>
  );
}
