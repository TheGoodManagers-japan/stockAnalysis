"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function sentimentColor(sentiment) {
  if (sentiment === "Bullish") return "var(--accent-green)";
  if (sentiment === "Bearish") return "var(--accent-red)";
  return "var(--text-muted)";
}

function impactBadgeClass(level) {
  if (level === "high") return "badge-sell";
  if (level === "medium") return "badge-hold";
  return "badge-neutral";
}

function sentimentBadgeClass(sentiment) {
  if (sentiment === "Bullish") return "badge-buy";
  if (sentiment === "Bearish") return "badge-sell";
  return "badge-neutral";
}

export default function NewsPage() {
  const [articles, setArticles] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 30;

  // Daily report state
  const [dailyReport, setDailyReport] = useState(null);
  const [reportExpanded, setReportExpanded] = useState(true);
  const [generatingReport, setGeneratingReport] = useState(false);

  // Filters
  const [source, setSource] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [impact, setImpact] = useState("");
  const [ticker, setTicker] = useState("");

  const fetchNews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (source) params.set("source", source);
      if (sentiment) params.set("sentiment", sentiment);
      if (impact) params.set("impact", impact);
      if (ticker) params.set("ticker", ticker);
      params.set("page", page);
      params.set("limit", limit);
      params.set("analyzed", "false"); // show all articles

      const res = await fetch(`/api/news?${params}`);
      const json = await res.json();
      if (json.success) {
        setArticles(json.articles || []);
        setTotal(json.total || 0);
        setStats(json.stats || {});
      }
    } catch (err) {
      console.error("Failed to fetch news:", err);
    } finally {
      setLoading(false);
    }
  }, [source, sentiment, impact, ticker, page]);

  const fetchWatchlist = useCallback(async () => {
    try {
      const res = await fetch("/api/news/watchlist");
      const json = await res.json();
      if (json.success) setWatchlist(json.watchlist || []);
    } catch (err) {
      console.error("Failed to fetch watchlist:", err);
    }
  }, []);

  const fetchDailyReport = useCallback(async () => {
    try {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
      const res = await fetch(`/api/news/daily-report?date=${today}`);
      const json = await res.json();
      if (json.success && !json.empty) setDailyReport(json);
    } catch (err) {
      console.error("Failed to fetch daily report:", err);
    }
  }, []);

  async function generateDailyReport() {
    setGeneratingReport(true);
    try {
      const res = await fetch("/api/news/daily-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success && !json.empty) {
        setDailyReport(json);
        setReportExpanded(true);
      }
    } catch (err) {
      console.error("Failed to generate daily report:", err);
    } finally {
      setGeneratingReport(false);
    }
  }

  useEffect(() => {
    fetchNews();
    fetchWatchlist();
    fetchDailyReport();
  }, [fetchNews, fetchWatchlist, fetchDailyReport]);

  const [fetching, setFetching] = useState(false);

  async function handleFetchAll() {
    setFetching(true);
    try {
      const res = await fetch("/api/news/fetch?source=all", { method: "POST" });
      const json = await res.json();
      console.log("[news] Fetch results:", json);
      await fetchNews();
      await fetchWatchlist();
    } catch (err) {
      console.error("Fetch failed:", err);
    } finally {
      setFetching(false);
    }
  }

  const [analyzeProgress, setAnalyzeProgress] = useState("");

  async function handleAnalyze({ all = false, reanalyze = false } = {}) {
    setAnalyzing(true);
    setAnalyzeProgress("");
    try {
      let totalAnalyzed = 0;
      let iterations = 0;
      const maxIterations = all ? 20 : 1;

      do {
        const body = { limit: 50 };
        if (reanalyze && iterations === 0) body.reanalyze = true;
        const res = await fetch("/api/news/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        const batchCount = json.analyzed || 0;
        totalAnalyzed += batchCount;
        iterations++;
        if (all) setAnalyzeProgress(`${totalAnalyzed} analyzed...`);
        if (batchCount === 0) break;
      } while (iterations < maxIterations);

      await fetchNews();
      await fetchWatchlist();

      // Auto-generate daily report after analysis completes
      if (totalAnalyzed > 0) {
        setAnalyzeProgress("Generating daily report...");
        try {
          const reportRes = await fetch("/api/news/daily-report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const reportJson = await reportRes.json();
          if (reportJson.success && !reportJson.empty) {
            setDailyReport(reportJson);
            setReportExpanded(true);
          }
        } catch (err) {
          console.error("Daily report generation failed:", err);
        }
      }

      setAnalyzeProgress(totalAnalyzed > 0 ? `Done: ${totalAnalyzed} articles` : "No pending articles");
    } catch (err) {
      console.error("Analyze failed:", err);
      setAnalyzeProgress("Error");
    } finally {
      setAnalyzing(false);
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <>
      <div className="flex-between mb-lg">
        <h2 style={{ color: "var(--text-heading)" }}>News Feed</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={handleFetchAll} disabled={fetching}>
            {fetching ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Fetching...</> : "Fetch All Sources"}
          </button>
          <button className="btn btn-primary" onClick={() => handleAnalyze({ all: true })} disabled={analyzing}>
            {analyzing ? <><span className="spinner" style={{ width: 14, height: 14 }} /> {analyzeProgress || "Analyzing..."}</> : "Analyze All"}
          </button>
          <button className="btn btn-secondary" onClick={() => handleAnalyze({ all: true, reanalyze: true })} disabled={analyzing} title="Re-analyze articles missing ticker associations">
            {analyzing ? null : "Re-analyze"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid-4 mb-lg">
        <div className="card">
          <div className="card-subtitle">Today</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--text-heading)" }}>
            {stats.today_count || 0}
          </div>
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
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--accent-orange)" }}>
            {stats.high_impact_count || 0}
          </div>
        </div>
        <div className="card">
          <div className="card-subtitle">Unanalyzed</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: stats.unanalyzed_count > 0 ? "var(--accent-yellow)" : "var(--text-heading)" }}>
            {stats.unanalyzed_count || 0}
          </div>
        </div>
      </div>

      {/* Daily Report */}
      {dailyReport && dailyReport.report && (
        <div className="card mb-lg daily-report">
          <div className="flex-between mb-md">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setReportExpanded(!reportExpanded)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--text-heading)", fontSize: "0.85rem", padding: 0,
                }}
              >
                {reportExpanded ? "\u25BC" : "\u25B6"}
              </button>
              <div className="card-title" style={{ color: "var(--accent-blue)", margin: 0 }}>
                Daily Report
              </div>
              <span className="text-muted" style={{ fontSize: "0.75rem" }}>
                {dailyReport.report_date} &middot; {dailyReport.article_count} articles
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {dailyReport.generated_at && (
                <span className="text-muted" style={{ fontSize: "0.7rem" }}>
                  Generated {timeAgo(dailyReport.generated_at)}
                </span>
              )}
              <button
                className="btn btn-secondary btn-sm"
                onClick={generateDailyReport}
                disabled={generatingReport}
              >
                {generatingReport ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Generating...</> : "Regenerate"}
              </button>
            </div>
          </div>

          {reportExpanded && (
            <div className="daily-report-body">
              {/* Market Overview */}
              <div className="daily-report-overview mb-md">
                <div className="daily-report-section-title">Market Overview</div>
                <p>{dailyReport.report.market_overview}</p>
              </div>

              {/* High-Impact Events */}
              {dailyReport.report.high_impact_events?.length > 0 && (
                <div className="mb-md">
                  <div className="daily-report-section-title">High-Impact Events</div>
                  {dailyReport.report.high_impact_events.map((evt, i) => (
                    <div key={i} className="daily-report-event">
                      <div className="flex-between mb-sm">
                        <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{evt.headline}</div>
                        <span className={`badge ${sentimentBadgeClass(evt.sentiment)}`}>{evt.sentiment}</span>
                      </div>
                      <p className="text-muted" style={{ fontSize: "0.82rem", marginBottom: 6 }}>{evt.detail}</p>
                      {evt.tickers?.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {evt.tickers.map(t => (
                            <Link key={t} href={`/scanner/${t}`} style={{
                              fontSize: "0.75rem", fontWeight: 600, fontFamily: "var(--font-mono)",
                              color: "var(--accent-blue)", textDecoration: "none",
                              background: "rgba(59, 130, 246, 0.1)", padding: "1px 6px", borderRadius: 4,
                            }}>
                              {t.replace(".T", "")}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Sector Highlights */}
              {dailyReport.report.sector_highlights?.length > 0 && (
                <div className="mb-md">
                  <div className="daily-report-section-title">Sector Highlights</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                    {dailyReport.report.sector_highlights.map((sec, i) => (
                      <div key={i} className="daily-report-sector">
                        <div className="flex-between mb-sm">
                          <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{sec.sector}</span>
                          <span className={`badge ${
                            sec.tone === "Bullish" ? "badge-buy" : sec.tone === "Bearish" ? "badge-sell" : "badge-neutral"
                          }`}>{sec.tone}</span>
                        </div>
                        <p className="text-muted" style={{ fontSize: "0.8rem", margin: 0 }}>{sec.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ticker Watch */}
              {dailyReport.report.ticker_watch?.length > 0 && (
                <div className="mb-md">
                  <div className="daily-report-section-title">Ticker Watch</div>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Ticker</th>
                          <th>Articles</th>
                          <th>Sentiment</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyReport.report.ticker_watch.map((tw, i) => (
                          <tr key={i}>
                            <td>
                              <Link href={`/scanner/${tw.ticker}`} style={{
                                color: "var(--accent-blue)", textDecoration: "none",
                                fontWeight: 600, fontFamily: "var(--font-mono)",
                              }}>
                                {tw.ticker?.replace(".T", "")}
                              </Link>
                              {tw.in_portfolio && (
                                <span style={{
                                  fontSize: "0.65rem", color: "var(--accent-purple)",
                                  fontWeight: 600, marginLeft: 6,
                                }}>HELD</span>
                              )}
                            </td>
                            <td className="text-mono">{tw.article_count || "-"}</td>
                            <td>
                              <span className={`badge ${sentimentBadgeClass(tw.net_sentiment)}`}>
                                {tw.net_sentiment || "-"}
                              </span>
                            </td>
                            <td style={{ fontSize: "0.8rem", maxWidth: 300, whiteSpace: "normal" }}>{tw.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Trading Implications */}
              {dailyReport.report.trading_implications && (
                <div className="daily-report-implications">
                  <div className="daily-report-section-title">Trading Implications</div>
                  <p>{dailyReport.report.trading_implications}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="card mb-lg" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label>Source</label>
          <select value={source} onChange={e => { setSource(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="kabutan">Kabutan</option>
            <option value="jquants">J-Quants</option>
            <option value="yahoo_rss">Yahoo JP</option>
            <option value="nikkei">Nikkei</option>
            <option value="minkabu">Minkabu</option>
            <option value="reuters">Reuters</option>
          </select>
        </div>
        <div>
          <label>Sentiment</label>
          <select value={sentiment} onChange={e => { setSentiment(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="Bullish">Bullish</option>
            <option value="Bearish">Bearish</option>
            <option value="Neutral">Neutral</option>
          </select>
        </div>
        <div>
          <label>Impact</label>
          <select value={impact} onChange={e => { setImpact(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div>
          <label>Ticker</label>
          <input
            type="text"
            placeholder="e.g. 7203"
            value={ticker}
            onChange={e => { setTicker(e.target.value); setPage(1); }}
            style={{ width: 100 }}
          />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => { setSource(""); setSentiment(""); setImpact(""); setTicker(""); setPage(1); }}>
          Clear
        </button>
      </div>

      {/* Main content: News + Watchlist */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>

        {/* News Timeline */}
        <div>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>
          ) : articles.length === 0 ? (
            <div className="card"><p className="text-muted">No articles found. Adjust filters or ingest news first.</p></div>
          ) : (
            <>
              {articles.map(article => {
                const tickers = typeof article.tickers === "string" ? JSON.parse(article.tickers) : article.tickers || [];
                return (
                  <div
                    key={article.id}
                    className="card mb-md"
                    style={{
                      borderLeft: `3px solid ${article.is_analyzed ? sentimentColor(article.sentiment) : "var(--border-secondary)"}`,
                      padding: 16,
                    }}
                  >
                    {/* Header: source + time */}
                    <div className="flex-between mb-sm">
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span className="badge badge-source" data-source={article.source}>
                          {article.source}
                        </span>
                        {article.category && (
                          <span className="badge badge-neutral" style={{ fontSize: "0.68rem" }}>
                            {article.category}
                          </span>
                        )}
                      </div>
                      <span className="text-muted" style={{ fontSize: "0.75rem" }}>
                        {timeAgo(article.published_at)}
                      </span>
                    </div>

                    {/* Title */}
                    <div style={{ fontWeight: 600, marginBottom: 6, lineHeight: 1.4 }}>
                      {article.source_url ? (
                        <a href={article.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-heading)", textDecoration: "none" }}>
                          {article.title_ja || article.title}
                        </a>
                      ) : (
                        article.title_ja || article.title
                      )}
                    </div>

                    {/* AI Summary */}
                    {article.ai_summary && (
                      <p className="text-muted" style={{ fontSize: "0.82rem", marginBottom: 8, lineHeight: 1.5 }}>
                        {article.ai_summary}
                      </p>
                    )}

                    {/* Footer: tickers + badges */}
                    <div className="flex-between" style={{ flexWrap: "wrap", gap: 6 }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {tickers.map(t => (
                          <Link
                            key={t.ticker_code}
                            href={`/scanner/${t.ticker_code}`}
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              fontFamily: "var(--font-mono)",
                              color: "var(--accent-blue)",
                              textDecoration: "none",
                              background: "rgba(59, 130, 246, 0.1)",
                              padding: "1px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {t.ticker_code.replace(".T", "")}
                          </Link>
                        ))}
                      </div>
                      {article.is_analyzed && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <span className={`badge ${sentimentBadgeClass(article.sentiment)}`}>
                            {article.sentiment}
                          </span>
                          <span className={`badge ${impactBadgeClass(article.impact_level)}`}>
                            {article.impact_level}
                          </span>
                          {article.news_category && article.news_category !== "other" && (
                            <span className="badge badge-neutral">{article.news_category}</span>
                          )}
                        </div>
                      )}
                      {!article.is_analyzed && (
                        <span className="badge badge-neutral" style={{ fontStyle: "italic" }}>pending analysis</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
                  <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    Prev
                  </button>
                  <span className="text-muted" style={{ lineHeight: "32px", fontSize: "0.82rem" }}>
                    {page} / {totalPages}
                  </span>
                  <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Watchlist Sidebar */}
        <div className="card" style={{ position: "sticky", top: 80, alignSelf: "start" }}>
          <div className="card-title mb-md" style={{ color: "var(--accent-purple)" }}>
            News Watchlist
          </div>
          {watchlist.length === 0 ? (
            <p className="text-muted" style={{ fontSize: "0.82rem" }}>
              No watchlist candidates yet. Ingest and analyze news to generate signals.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {watchlist.map(w => (
                <div
                  key={w.ticker_code}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border-primary)",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Link
                        href={`/scanner/${w.ticker_code}`}
                        style={{ color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600, fontFamily: "var(--font-mono)" }}
                      >
                        {w.ticker_code.replace(".T", "")}
                      </Link>
                      {w.max_impact === "high" && (
                        <span className="badge badge-sell" style={{ fontSize: "0.6rem" }}>HIGH IMPACT</span>
                      )}
                    </div>
                    {w.short_name && (
                      <div className="text-muted" style={{ fontSize: "0.72rem" }}>{w.short_name}</div>
                    )}
                    <div className="text-muted" style={{ fontSize: "0.7rem", marginTop: 2 }}>
                      {w.article_count} article{w.article_count !== 1 ? "s" : ""} · {w.sources_count} source{w.sources_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{
                      fontSize: "1rem",
                      fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                      color: w.avg_sentiment > 0.3 ? "var(--accent-green)" : w.avg_sentiment < -0.3 ? "var(--accent-red)" : "var(--text-primary)",
                    }}>
                      {Number(w.composite_score).toFixed(2)}
                    </div>
                    <span className={`badge ${w.max_impact === "high" ? "badge-sell" : w.max_impact === "medium" ? "badge-hold" : "badge-neutral"}`} style={{ fontSize: "0.6rem" }}>
                      {w.max_impact}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
