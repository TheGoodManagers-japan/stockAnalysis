"use client";

import { useState } from "react";
import { VERDICT_CONFIG, confidenceColor } from "../../lib/uiHelpers";

function normalizeReview(raw) {
  if (!raw) return null;
  const fa = raw.full_analysis || {};
  return {
    verdict: raw.verdict || fa.verdict,
    verdict_reason: raw.verdict_reason || fa.verdict_reason,
    confidence: raw.confidence ?? fa.confidence,
    company_description: raw.company_description || fa.company_description,
    news_summary: raw.news_summary || fa.news_summary,
    macro_context: raw.macro_context || fa.macro_context,
    earnings_status: raw.earnings_status || fa.earnings_status,
    bull_points: raw.bull_points || fa.bull_points || [],
    bear_points: raw.bear_points || fa.bear_points || [],
    risk_reward_assessment: raw.risk_reward_assessment || fa.risk_reward_assessment,
    key_catalyst: raw.key_catalyst || fa.key_catalyst,
    watch_for: raw.watch_for || fa.watch_for,
  };
}

export default function AIAnalysisSection({ tickerCode, initialReview }) {
  const [rawReview, setRawReview] = useState(initialReview);
  const [loading, setLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const review = normalizeReview(rawReview);

  async function handleAnalyze() {
    setLoading(true);
    try {
      const res = await fetch(`/api/scan/ai-review?ticker=${tickerCode}`);
      const data = await res.json();
      if (data.success && data.reviews && data.reviews.length > 0) {
        setRawReview(data.reviews[0]);
      }
    } catch (err) {
      console.error("Analysis failed", err);
    } finally {
      setLoading(false);
    }
  }

  const verdict = review ? VERDICT_CONFIG[review.verdict] : null;

  if (!review) {
    return (
      <div className="card mb-lg">
        <div className="card-title mb-md">AI Analysis</div>
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
            <span>Analyze with AI</span>
          )}
        </button>
      </div>
    );
  }

  const hasBullBear = review.bull_points.length > 0 || review.bear_points.length > 0;
  const hasActionItems = review.risk_reward_assessment || review.key_catalyst || review.watch_for;

  return (
    <div className="card mb-lg">
      {/* Header: title + re-analyze */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="card-title" style={{ margin: 0 }}>AI Analysis</div>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          style={{
            background: "transparent",
            border: "1px solid var(--border-primary)",
            color: "var(--text-secondary)",
            padding: "4px 12px",
            borderRadius: "4px",
            fontSize: "0.78rem",
            cursor: loading ? "wait" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {loading ? (
            <>
              <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
              <span>Re-analyzing...</span>
            </>
          ) : (
            <span>Re-analyze</span>
          )}
        </button>
      </div>

      {/* Verdict badge + confidence */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span
          className="badge"
          style={{
            background: verdict?.bg,
            color: verdict?.color,
            border: `1px solid ${verdict?.border}`,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            fontSize: "0.9rem",
            fontWeight: 600,
          }}
        >
          {verdict?.icon} {verdict?.label}
        </span>
        {review.confidence != null && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: confidenceColor(review.confidence) }}>
              {review.confidence}%
            </span>
            <div style={{ flex: 1, maxWidth: 120, height: 6, background: "var(--bg-tertiary)", borderRadius: 3 }}>
              <div style={{ width: `${review.confidence}%`, height: "100%", background: confidenceColor(review.confidence), borderRadius: 3 }} />
            </div>
          </div>
        )}
      </div>

      {/* Verdict reason */}
      <div style={{ fontSize: "0.9rem", color: "var(--text-primary)", lineHeight: 1.6, marginBottom: 16 }}>
        {review.verdict_reason}
      </div>

      {/* Bull / Bear columns */}
      {hasBullBear && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          {review.bull_points.length > 0 && (
            <div style={{ padding: "10px 12px", background: "rgba(16, 185, 129, 0.06)", borderLeft: "3px solid var(--accent-green)", borderRadius: "0 4px 4px 0" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--accent-green)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Bull Case
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.82rem", color: "var(--text-primary)", lineHeight: 1.6 }}>
                {review.bull_points.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          {review.bear_points.length > 0 && (
            <div style={{ padding: "10px 12px", background: "rgba(239, 68, 68, 0.06)", borderLeft: "3px solid var(--accent-red)", borderRadius: "0 4px 4px 0" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--accent-red)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Bear Case
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: "0.82rem", color: "var(--text-primary)", lineHeight: 1.6 }}>
                {review.bear_points.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Action items strip */}
      {hasActionItems && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
          {review.risk_reward_assessment && (
            <div style={{ padding: "8px 10px", background: "var(--bg-tertiary)", borderRadius: 4 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 3, textTransform: "uppercase" }}>Risk/Reward</div>
              <div style={{ fontSize: "0.82rem", color: "var(--text-primary)", lineHeight: 1.4 }}>{review.risk_reward_assessment}</div>
            </div>
          )}
          {review.key_catalyst && (
            <div style={{ padding: "8px 10px", background: "var(--bg-tertiary)", borderRadius: 4 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 3, textTransform: "uppercase" }}>Key Catalyst</div>
              <div style={{ fontSize: "0.82rem", color: "var(--text-primary)", lineHeight: 1.4 }}>{review.key_catalyst}</div>
            </div>
          )}
          {review.watch_for && (
            <div style={{ padding: "8px 10px", background: "var(--bg-tertiary)", borderRadius: 4 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 3, textTransform: "uppercase" }}>Watch For</div>
              <div style={{ fontSize: "0.82rem", color: "var(--text-primary)", lineHeight: 1.4 }}>{review.watch_for}</div>
            </div>
          )}
        </div>
      )}

      {/* Collapsible details */}
      {(review.company_description || review.news_summary || review.macro_context || review.earnings_status) && (
        <div>
          <button
            onClick={() => setDetailsOpen(!detailsOpen)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: "0.78rem",
              cursor: "pointer",
              padding: "4px 0",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {detailsOpen ? "\u25B2" : "\u25BC"} Details
          </button>
          {detailsOpen && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
              {review.company_description && (
                <div style={{ padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: 4 }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 3 }}>Company</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-primary)", lineHeight: 1.4 }}>{review.company_description}</div>
                </div>
              )}
              {review.news_summary && (
                <div style={{ padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: 4 }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 3 }}>News</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-primary)", lineHeight: 1.4 }}>{review.news_summary}</div>
                </div>
              )}
              {review.macro_context && (
                <div style={{ padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: 4 }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 3 }}>Macro</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-primary)", lineHeight: 1.4 }}>{review.macro_context}</div>
                </div>
              )}
              {review.earnings_status && (
                <div style={{ padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: 4 }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 3 }}>Earnings</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-primary)", lineHeight: 1.4 }}>{review.earnings_status}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
