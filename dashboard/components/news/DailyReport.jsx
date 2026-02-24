"use client";

import { useState } from "react";
import Link from "next/link";
import { timeAgo, sentimentBadgeClass } from "../../lib/uiHelpers";

export default function DailyReport({ report, onRegenerate, isGenerating }) {
  const [reportExpanded, setReportExpanded] = useState(true);

  if (!report || !report.report) return null;

  const r = report.report;

  return (
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
            {report.report_date} &middot; {report.article_count} articles
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {report.generated_at && (
            <span className="text-muted" style={{ fontSize: "0.7rem" }}>
              Generated {timeAgo(report.generated_at)}
            </span>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={onRegenerate}
            disabled={isGenerating}
          >
            {isGenerating ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Generating...</> : "Regenerate"}
          </button>
        </div>
      </div>

      {reportExpanded && (
        <div className="daily-report-body">
          {/* Market Overview */}
          <div className="daily-report-overview mb-md">
            <div className="daily-report-section-title">Market Overview</div>
            <p>{r.market_overview}</p>
          </div>

          {/* High-Impact Events */}
          {r.high_impact_events?.length > 0 && (
            <div className="mb-md">
              <div className="daily-report-section-title">High-Impact Events</div>
              {r.high_impact_events.map((evt, i) => (
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
          {r.sector_highlights?.length > 0 && (
            <div className="mb-md">
              <div className="daily-report-section-title">Sector Highlights</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                {r.sector_highlights.map((sec, i) => (
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
          {r.ticker_watch?.length > 0 && (
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
                    {r.ticker_watch.map((tw, i) => (
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
          {r.trading_implications && (
            <div className="daily-report-implications">
              <div className="daily-report-section-title">Trading Implications</div>
              <p>{r.trading_implications}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
