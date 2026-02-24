"use client";

import { useState, useCallback } from "react";

/**
 * Manages AI review fetching and expanded-row state for the scanner table.
 * @returns AI review data, loading state, and toggle/fetch handlers.
 */
export function useAiReview() {
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [aiReviews, setAiReviews] = useState({});
  const [loadingAi, setLoadingAi] = useState(null);

  const handleAiReview = useCallback(async (ticker) => {
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
  }, []);

  const toggleExpand = useCallback((ticker) => {
    setExpandedTicker((prev) => (prev === ticker ? null : ticker));
  }, []);

  return {
    expandedTicker,
    aiReviews,
    loadingAi,
    handleAiReview,
    toggleExpand,
  };
}
