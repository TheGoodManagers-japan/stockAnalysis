"use client";

import { useState, useEffect } from "react";

/**
 * Polls unacknowledged error count for the sidebar badge.
 */
export function useErrorCount(intervalMs = 30000) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function fetchCount() {
      try {
        const res = await fetch("/api/errors?acknowledged=false&limit=1");
        const data = await res.json();
        if (mounted && data.success) {
          setCount(data.unacknowledgedCount || 0);
        }
      } catch {
        // badge is non-critical
      }
    }

    fetchCount();
    const timer = setInterval(fetchCount, intervalMs);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return count;
}
