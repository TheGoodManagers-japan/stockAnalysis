"use client";

import { useState, useEffect } from "react";

function formatScanLabel(run) {
  const d = new Date(run.started_at);
  const date = d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const time = d.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time} — ${run.buy_count ?? 0} buys / ${run.ticker_count ?? 0} tickers`;
}

export default function ScanPicker({ onScanChange, currentScanId }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRuns() {
      try {
        const res = await fetch("/api/scan-runs?limit=30");
        const data = await res.json();
        if (data.success) setRuns(data.runs);
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchRuns();
  }, []);

  if (loading || runs.length === 0) return null;

  return (
    <select
      className="scan-picker"
      value={currentScanId || ""}
      onChange={(e) => onScanChange(e.target.value || null)}
      style={{
        background: "var(--bg-tertiary)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-primary)",
        borderRadius: "var(--radius-sm, 6px)",
        padding: "6px 10px",
        fontSize: "0.8rem",
        fontFamily: "inherit",
        cursor: "pointer",
        minWidth: 280,
      }}
    >
      <option value="">Latest Scan</option>
      {runs.map((run) => (
        <option key={run.scan_id} value={run.scan_id}>
          {formatScanLabel(run)}
        </option>
      ))}
    </select>
  );
}
