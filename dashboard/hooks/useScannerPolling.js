"use client";

import { useState, useEffect, useRef } from "react";
import { useSessionStorage } from "./useSessionStorage";

/**
 * Manages live polling for in-progress scans and historical scan fetching.
 * @param {boolean} isLive - Whether a live scan is running (enables polling).
 * @returns Live results, historical scan picker state, and loading flags.
 */
export function useScannerPolling(isLive) {
  const [selectedScanId, setSelectedScanId] = useSessionStorage("scanner-scanId", null);
  const [historicalResults, setHistoricalResults] = useState(null);
  const [loadingHistorical, setLoadingHistorical] = useState(false);

  const [liveResults, setLiveResults] = useState(null);
  const intervalRef = useRef(null);

  // Live polling when scan is running
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

  return {
    liveResults,
    selectedScanId,
    setSelectedScanId,
    historicalResults,
    loadingHistorical,
  };
}
