"use client";

import { useState } from "react";

export function useNewsActions(onRefresh) {
  const [fetching, setFetching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState("");

  async function handleFetchAll() {
    setFetching(true);
    try {
      const res = await fetch("/api/news/fetch?source=all", { method: "POST" });
      const json = await res.json();
      console.log("[news] Fetch results:", json);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error("Fetch failed:", err);
    } finally {
      setFetching(false);
    }
  }

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

      if (onRefresh) await onRefresh();

      // Return totalAnalyzed so the caller can trigger daily report generation
      setAnalyzeProgress(totalAnalyzed > 0 ? `Done: ${totalAnalyzed} articles` : "No pending articles");
      return totalAnalyzed;
    } catch (err) {
      console.error("Analyze failed:", err);
      setAnalyzeProgress("Error");
      return 0;
    } finally {
      setAnalyzing(false);
    }
  }

  return { fetching, analyzing, analyzeProgress, setAnalyzeProgress, handleFetchAll, handleAnalyze };
}
