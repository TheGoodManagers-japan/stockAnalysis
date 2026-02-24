"use client";

import { useState } from "react";
import { VERDICT_CONFIG } from "../../lib/uiHelpers";

export default function AIAnalysisSection({ tickerCode, initialReview }) {
  const [review, setReview] = useState(initialReview);
  const [loading, setLoading] = useState(false);

  async function handleAnalyze() {
    setLoading(true);
    try {
      const res = await fetch(`/api/scan/ai-review?ticker=${tickerCode}`);
      const data = await res.json();
      if (data.success && data.reviews && data.reviews.length > 0) {
        setReview(data.reviews[0]);
      }
    } catch (err) {
      console.error("Analysis failed", err);
    } finally {
      setLoading(false);
    }
  }

  const verdict = review ? VERDICT_CONFIG[review.verdict] : null;

  return (
    <div className="card mb-lg">
      <div className="card-title mb-md">AI Analysis</div>
      {review ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              className="badge"
              style={{
                background: verdict?.bg,
                color: verdict?.color,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: "0.9rem",
                border: `1px solid ${verdict?.border}`,
              }}
            >
              {verdict?.icon} {verdict?.label}
            </span>
          </div>
          <div style={{ fontSize: "0.9rem", color: "var(--text-primary)", lineHeight: 1.5 }}>
            {review.verdict_reason}
          </div>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            style={{
              background: "transparent",
              border: "1px solid var(--accent-blue)",
              color: "var(--accent-blue)",
              padding: "8px 16px",
              borderRadius: "4px",
              fontSize: "0.85rem",
              cursor: loading ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              justifyContent: "center",
              width: "fit-content",
            }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                <span>Re-analyzing...</span>
              </>
            ) : (
              <span>🔄 Re-analyze</span>
            )}
          </button>
        </div>
      ) : (
        <button
          onClick={handleAnalyze}
          disabled={loading}
          style={{
            background: "transparent",
            border: "1px solid var(--accent-blue)",
            color: "var(--accent-blue)",
            padding: "10px 20px",
            borderRadius: "4px",
            fontSize: "0.9rem",
            cursor: loading ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            justifyContent: "center",
          }}
        >
          {loading ? (
            <>
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              <span>Analysing...</span>
            </>
          ) : (
            <>
              <span>✨ Analyze with AI</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
