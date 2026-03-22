"use client";

import { useState, useEffect, useRef } from "react";

export default function ScanProgress({ scanId, onComplete }) {
  const [progress, setProgress] = useState(null);
  const intervalRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!scanId) return;

    async function poll() {
      try {
        const res = await fetch("/api/scan/progress");
        if (!res.ok) return;
        const data = await res.json();
        const scan = data.scan;
        if (!scan) return;

        setProgress(scan);

        if (scan.status === "completed" || scan.status === "failed") {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          if (onCompleteRef.current) onCompleteRef.current(scan);
        }
      } catch {
        // Silently retry on next interval
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [scanId]);

  if (!progress || progress.status !== "running") return null;

  const processed = progress.ticker_count || 0;
  const total = progress.total_tickers || 1;
  const buyCount = progress.buy_count || 0;
  const currentTicker = progress.current_ticker;

  // Detect phase steps (e.g., "Step 3/8: Analyzing news...")
  const isPhase = currentTicker && currentTicker.startsWith("Step ");
  // During scanning phase (step 4), show real progress bar; otherwise show step indicator
  const isScanning = processed > 0 || (isPhase && currentTicker.includes("Scanning"));
  const pct = isScanning ? Math.round((processed / total) * 100) : 0;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 12px",
      }}
    >
      {/* Progress bar */}
      <div
        style={{
          width: 120,
          height: 6,
          background: "var(--bg-tertiary, #333)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        {isPhase && !isScanning ? (
          /* Indeterminate animation during non-scan phases */
          <div
            style={{
              width: "40%",
              height: "100%",
              background: "var(--accent-blue, #3b82f6)",
              borderRadius: 3,
              animation: "indeterminate 1.5s ease-in-out infinite",
            }}
          />
        ) : (
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "var(--accent-blue, #3b82f6)",
              borderRadius: 3,
              transition: "width 300ms ease",
            }}
          />
        )}
      </div>

      {/* Phase step or percentage */}
      {isPhase && !isScanning ? (
        <span
          style={{
            fontSize: "0.78rem",
            fontWeight: 500,
            color: "var(--text-secondary, #aaa)",
            whiteSpace: "nowrap",
          }}
        >
          {currentTicker}
        </span>
      ) : (
        <>
          <span
            style={{
              fontSize: "0.82rem",
              fontWeight: 600,
              color: "var(--text-primary, #eee)",
              whiteSpace: "nowrap",
              minWidth: 36,
            }}
          >
            {pct}%
          </span>

          <span
            style={{
              fontSize: "0.78rem",
              color: "var(--text-secondary, #aaa)",
              whiteSpace: "nowrap",
            }}
          >
            {processed}/{total}
            {buyCount > 0 && (
              <span
                style={{ color: "var(--accent-green, #22c55e)", marginLeft: 6 }}
              >
                {buyCount} buys
              </span>
            )}
          </span>

          {currentTicker && !isPhase && (
            <span
              style={{
                fontSize: "0.72rem",
                color: "var(--text-muted, #666)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {currentTicker}
            </span>
          )}

          {/* Show post-scan phase text alongside 100% bar */}
          {isPhase && (
            <span
              style={{
                fontSize: "0.72rem",
                color: "var(--text-muted, #666)",
              }}
            >
              {currentTicker}
            </span>
          )}
        </>
      )}

      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
