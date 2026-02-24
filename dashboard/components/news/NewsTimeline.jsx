"use client";

import Link from "next/link";
import { timeAgo, sentimentColor, sentimentBadgeClass, impactBadgeClass } from "../../lib/uiHelpers";

export default function NewsTimeline({ articles, loading, page, totalPages, onPageChange }) {
  if (loading) {
    return <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>;
  }

  if (articles.length === 0) {
    return (
      <div className="card">
        <p className="text-muted">No articles found. Adjust filters or ingest news first.</p>
      </div>
    );
  }

  return (
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
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Prev
          </button>
          <span className="text-muted" style={{ lineHeight: "32px", fontSize: "0.82rem" }}>
            {page} / {totalPages}
          </span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  );
}
