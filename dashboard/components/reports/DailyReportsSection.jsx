"use client";

import { useState, useEffect } from "react";

const SENTIMENT_COLORS = {
  Bullish: "var(--accent-green)",
  Bearish: "var(--accent-red)",
  Mixed: "var(--accent-yellow, #f59e0b)",
  Neutral: "var(--text-secondary)",
};

function SentimentBadge({ sentiment }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: "0.75rem",
        fontWeight: 600,
        background: `${SENTIMENT_COLORS[sentiment] || "var(--text-secondary)"}20`,
        color: SENTIMENT_COLORS[sentiment] || "var(--text-secondary)",
      }}
    >
      {sentiment}
    </span>
  );
}

function ReportCard({ report, date, articleCount, generatedAt, isExpanded, onToggle }) {
  const r = typeof report === "string" ? JSON.parse(report) : report;

  return (
    <div className="card mb-md">
      <div
        onClick={onToggle}
        style={{
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <span style={{ fontWeight: 600, color: "var(--text-heading)", fontSize: "0.95rem" }}>
            {new Date(date + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <span style={{ marginLeft: 12, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            {articleCount} articles
          </span>
        </div>
        <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {isExpanded ? "▲" : "▼"}
        </span>
      </div>

      {isExpanded && r && (
        <div style={{ marginTop: 16 }}>
          {/* Market Overview */}
          {r.market_overview && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-heading)", marginBottom: 6 }}>
                Market Overview
              </div>
              <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, color: "var(--text-primary)" }}>
                {r.market_overview}
              </p>
            </div>
          )}

          {/* High Impact Events */}
          {r.high_impact_events?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-heading)", marginBottom: 6 }}>
                Key Events
              </div>
              {r.high_impact_events.map((e, i) => (
                <div
                  key={i}
                  style={{
                    padding: "8px 12px",
                    marginBottom: 6,
                    borderRadius: 6,
                    background: "var(--bg-tertiary)",
                    borderLeft: `3px solid ${SENTIMENT_COLORS[e.sentiment] || "var(--border-primary)"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <SentimentBadge sentiment={e.sentiment} />
                    <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{e.headline}</span>
                  </div>
                  {e.detail && (
                    <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>{e.detail}</p>
                  )}
                  {e.tickers?.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {e.tickers.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Sector Highlights */}
          {r.sector_highlights?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-heading)", marginBottom: 6 }}>
                Sectors
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {r.sector_highlights.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      flex: "1 1 calc(50% - 4px)",
                      minWidth: 200,
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: "var(--bg-tertiary)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <SentimentBadge sentiment={s.tone} />
                      <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{s.sector}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>{s.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ticker Watch */}
          {r.ticker_watch?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-heading)", marginBottom: 6 }}>
                Ticker Watch
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: "0.82rem", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-primary)" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-secondary)", fontWeight: 500 }}>Ticker</th>
                      <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-secondary)", fontWeight: 500 }}>Sentiment</th>
                      <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-secondary)", fontWeight: 500 }}>Articles</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-secondary)", fontWeight: 500 }}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.ticker_watch.map((t, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border-secondary, var(--border-primary))" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 500 }}>
                          {t.ticker}
                          {t.in_portfolio && (
                            <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "var(--accent-green)" }}>HELD</span>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "center" }}>
                          <SentimentBadge sentiment={t.net_sentiment || "Neutral"} />
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "center", color: "var(--text-secondary)" }}>
                          {t.article_count || "-"}
                        </td>
                        <td style={{ padding: "6px 8px", color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                          {t.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Trading Implications */}
          {r.trading_implications && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 6,
                background: "var(--bg-tertiary)",
                borderLeft: "3px solid var(--accent-blue, #3b82f6)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-heading)", marginBottom: 4 }}>
                Trading Implications
              </div>
              <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, color: "var(--text-primary)" }}>
                {r.trading_implications}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DailyReportsSection({ days }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedDate, setExpandedDate] = useState(null);
  const [backfillInfo, setBackfillInfo] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    async function fetchReports() {
      try {
        const res = await fetch(`/api/news/daily-report?list=true&days=${days}`);
        const json = await res.json();
        if (json.success && json.reports) {
          setReports(json.reports);
          if (json.reports.length > 0) {
            setExpandedDate(json.reports[0].report_date);
          }
        } else if (!json.success) {
          setError(json.error || "Failed to load reports");
        }
      } catch (err) {
        setError(err.message || "Failed to load reports");
      } finally {
        setLoading(false);
      }

      // Check for dates that have articles but no reports
      try {
        const backfillRes = await fetch("/api/news/daily-report/backfill");
        const backfillJson = await backfillRes.json();
        if (backfillJson.success && backfillJson.missingDates > 0) {
          setBackfillInfo(backfillJson);
        }
      } catch {}
    }
    fetchReports();
  }, [days]);

  async function handleGenerate() {
    setGenerating(true);
    setGenProgress("Generating reports...");
    try {
      let totalGenerated = 0;
      let remaining = 1;

      while (remaining > 0) {
        const res = await fetch("/api/news/daily-report/backfill", { method: "POST" });
        const json = await res.json();
        if (!json.success) {
          setGenProgress(`Error: ${json.error}`);
          break;
        }
        totalGenerated += json.generated.length;
        remaining = json.remaining;
        setGenProgress(
          `Generated ${totalGenerated} report${totalGenerated !== 1 ? "s" : ""}` +
          (remaining > 0 ? `, ${remaining} remaining...` : " — done!")
        );
      }

      // Refresh the reports list
      const res = await fetch(`/api/news/daily-report?list=true&days=${days}`);
      const json = await res.json();
      if (json.success && json.reports) {
        setReports(json.reports);
        if (json.reports.length > 0) {
          setExpandedDate(json.reports[0].report_date);
        }
      }
      setBackfillInfo(null);
    } catch (err) {
      setGenProgress(`Error: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>;
  }

  if (error) {
    return <div className="card" style={{ color: "var(--accent-red)" }}>Error: {error}</div>;
  }

  if (reports.length === 0 && !backfillInfo) {
    return (
      <div className="card text-muted" style={{ textAlign: "center", padding: 40 }}>
        No daily reports yet. Reports are generated automatically with each morning scan.
      </div>
    );
  }

  return (
    <div>
      {/* Backfill banner */}
      {backfillInfo && backfillInfo.missingDates > 0 && (
        <div
          className="card mb-md"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: "var(--bg-tertiary)",
            borderLeft: "3px solid var(--accent-blue, #3b82f6)",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-heading)" }}>
              {backfillInfo.missingDates} date{backfillInfo.missingDates !== 1 ? "s" : ""} with analyzed articles but no report
            </div>
            {genProgress && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
                {genProgress}
              </div>
            )}
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent-blue, #3b82f6)",
              color: "#fff",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: generating ? "not-allowed" : "pointer",
              opacity: generating ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {generating ? "Generating..." : "Generate Reports"}
          </button>
        </div>
      )}

      {reports.map((r) => (
        <ReportCard
          key={r.report_date}
          report={r.report_json}
          date={r.report_date}
          articleCount={r.article_count}
          generatedAt={r.generated_at}
          isExpanded={expandedDate === r.report_date}
          onToggle={() => setExpandedDate(expandedDate === r.report_date ? null : r.report_date)}
        />
      ))}
    </div>
  );
}
