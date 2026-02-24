"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./SpaceFund.module.css";

export default function SpaceFundNewsTab() {
  const [news, setNews] = useState([]);

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch("/api/space-fund/news?limit=30");
      const data = await res.json();
      if (data.success) setNews(data.articles);
    } catch (err) {
      console.error("Failed to fetch news:", err);
    }
  }, []);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  return (
    <>
      {news.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <p className="text-muted">No news articles found for your space fund tickers.</p>
          <p className="text-muted" style={{ fontSize: "0.8rem" }}>Fetch news from the News page first, then come back here.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {news.map((article) => (
            <div key={article.id} className={styles.newsCard} data-sentiment={article.sentiment}>
              <div className="flex-between mb-sm">
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {article.matched_ticker && (
                    <span style={{ fontWeight: 600, color: "var(--accent-blue)", fontSize: "0.8rem" }}>{article.matched_ticker}</span>
                  )}
                  {article.impact_level && (
                    <span className={`badge ${article.impact_level === "high" ? "badge-sell" : article.impact_level === "medium" ? "badge-hold" : "badge-neutral"}`} style={{ fontSize: "0.65rem" }}>
                      {article.impact_level}
                    </span>
                  )}
                  {article.sentiment && (
                    <span style={{ fontSize: "0.7rem", color: article.sentiment === "Bullish" ? "var(--accent-green)" : article.sentiment === "Bearish" ? "var(--accent-red)" : "var(--text-muted)" }}>
                      {article.sentiment}
                    </span>
                  )}
                </div>
                <span className="text-muted" style={{ fontSize: "0.72rem" }}>
                  {article.published_at ? new Date(article.published_at).toLocaleDateString("ja-JP") : ""}
                </span>
              </div>
              <div style={{ fontWeight: 500, fontSize: "0.9rem", marginBottom: 4 }}>
                {article.source_url ? (
                  <a href={article.source_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                    {article.title}
                  </a>
                ) : article.title}
              </div>
              {article.ai_summary && (
                <div className="text-muted" style={{ fontSize: "0.8rem" }}>{article.ai_summary}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
