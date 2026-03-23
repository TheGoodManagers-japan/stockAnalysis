"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { reportError } from "../lib/reportError";

const CACHE_TTL = 60_000; // 60 seconds

/**
 * Fetches news context (article count, sentiment, impact, watchlist status)
 * for a list of tickers via /api/news/ticker-context.
 *
 * Returns a Map-like object: { [ticker_code]: { article_count, avg_sentiment, max_impact, latest_headline, on_watchlist } }
 */
export function useNewsContext(tickers) {
  const [newsContext, setNewsContext] = useState({});
  const cacheRef = useRef({ data: {}, fetchedAt: 0, key: "" });

  // Stable key derived from ticker list — only changes when tickers actually change
  const tickerKey = useMemo(() => {
    if (!tickers || tickers.length === 0) return "";
    return tickers.slice().sort().join(",");
  }, [tickers]);

  useEffect(() => {
    if (!tickerKey) return;

    const cache = cacheRef.current;

    // Return cached data if same tickers and within TTL
    if (cache.key === tickerKey && Date.now() - cache.fetchedAt < CACHE_TTL) {
      if (Object.keys(cache.data).length > 0) {
        setNewsContext(cache.data);
      }
      return;
    }

    let cancelled = false;

    async function fetchContext() {
      try {
        const res = await fetch(`/api/news/ticker-context?tickers=${encodeURIComponent(tickerKey)}`);
        const json = await res.json();
        if (!cancelled && json.success) {
          cacheRef.current = { data: json.context, fetchedAt: Date.now(), key: tickerKey };
          setNewsContext(json.context);
        }
      } catch (err) {
        reportError("hook/useNewsContext", err);
      }
    }

    fetchContext();
    return () => { cancelled = true; };
  }, [tickerKey]);

  return newsContext;
}
