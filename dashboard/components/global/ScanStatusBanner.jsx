"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Indeterminate scanning status banner for global market scans.
 * Shows elapsed time and phase info while the background script runs.
 */
export default function ScanStatusBanner({ scanning }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);

  useEffect(() => {
    if (!scanning) {
      setElapsed(0);
      startRef.current = null;
      return;
    }

    startRef.current = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [scanning]);

  if (!scanning) return null;

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  // Phase estimate based on elapsed time
  let phase = "Starting global market scan...";
  if (elapsed >= 5 && elapsed < 70) phase = "Phase 1/2: Scanning regime indicators (13 tickers)...";
  else if (elapsed >= 70) phase = "Phase 2/2: Scanning ETF signals (25 tickers)...";

  return (
    <div style={{
      padding: "0.75rem 1rem",
      borderRadius: "8px",
      background: "var(--bg-secondary)",
      border: "1px solid var(--accent-blue, #3b82f6)30",
      marginBottom: "1rem",
      display: "flex",
      alignItems: "center",
      gap: "1rem",
    }}>
      {/* Spinner */}
      <div style={{
        width: 18,
        height: 18,
        border: "2px solid var(--bg-tertiary)",
        borderTopColor: "var(--accent-blue, #3b82f6)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
        flexShrink: 0,
      }} />

      {/* Progress bar */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
      }}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 500, color: "var(--text-primary)" }}>
            {phase}
          </span>
          <span style={{
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            fontFamily: "monospace",
          }}>
            {timeStr}
          </span>
        </div>

        {/* Indeterminate bar */}
        <div style={{
          width: "100%",
          height: 4,
          background: "var(--bg-tertiary)",
          borderRadius: 2,
          overflow: "hidden",
        }}>
          <div style={{
            width: "35%",
            height: "100%",
            background: "var(--accent-blue, #3b82f6)",
            borderRadius: 2,
            animation: "indeterminate 1.8s ease-in-out infinite",
          }} />
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(300%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
