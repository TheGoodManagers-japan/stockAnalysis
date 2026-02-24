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

export default function ScanPicker({ onScanChange, currentScanId, onDelete }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    fetchRuns();
  }, []);

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

  async function handleDelete() {
    const scanId = confirmId;
    if (!scanId || deleting) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/scan-runs?scanId=${scanId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setRuns((prev) => prev.filter((r) => r.scan_id !== scanId));
        onScanChange(null);
        onDelete?.(scanId);
      }
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
      setConfirmId(null);
    }
  }

  if (loading || runs.length === 0) return null;

  // When "Latest Scan" is selected (currentScanId is null), the effective scan is runs[0]
  const effectiveScanId = currentScanId || runs[0]?.scan_id;
  const showDeleteBtn = effectiveScanId && runs.some((r) => r.scan_id === effectiveScanId);
  const isConfirming = confirmId === effectiveScanId;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <select
        className="scan-picker"
        value={currentScanId || ""}
        onChange={(e) => {
          setConfirmId(null);
          onScanChange(e.target.value || null);
        }}
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

      {showDeleteBtn && (
        isConfirming ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{
                background: "var(--accent-red, #e74c3c)",
                color: "#fff",
                border: "none",
                borderRadius: "var(--radius-sm, 6px)",
                padding: "4px 10px",
                fontSize: "0.75rem",
                cursor: deleting ? "wait" : "pointer",
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? "Deleting..." : "Confirm"}
            </button>
            <button
              onClick={() => setConfirmId(null)}
              disabled={deleting}
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-sm, 6px)",
                padding: "4px 8px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmId(effectiveScanId)}
            title="Delete this scan"
            style={{
              background: "transparent",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-sm, 6px)",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px 7px",
              fontSize: "0.85rem",
              lineHeight: 1,
              transition: "color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--accent-red, #e74c3c)";
              e.currentTarget.style.borderColor = "var(--accent-red, #e74c3c)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.borderColor = "var(--border-primary)";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M13 4v9.33a1.33 1.33 0 01-1.33 1.34H4.33A1.33 1.33 0 013 13.33V4" />
            </svg>
          </button>
        )
      )}
    </div>
  );
}
