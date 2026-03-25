"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./ValuePlayCard.module.css";
import {
  formatNum,
  formatSector,
  gradeColor,
  gradeBg,
  classificationLabel,
  classificationColor,
  classificationBg,
  valuationColor,
  pillarColor,
} from "../../lib/uiHelpers";

function fmt(v, suffix = "") {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  return `${Number(v).toFixed(1)}${suffix}`;
}

const REC_COLORS = {
  STRONG_BUY: { color: "#10b981", bg: "rgba(16, 185, 129, 0.12)", border: "#10b981" },
  BUY: { color: "#3b82f6", bg: "rgba(59, 130, 246, 0.12)", border: "#3b82f6" },
  HOLD: { color: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", border: "#f59e0b" },
  AVOID: { color: "#ef4444", bg: "rgba(239, 68, 68, 0.12)", border: "#ef4444" },
};

export default function ValuePlayCard({ stock, isAdded, onAddClick }) {
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [aiError, setAiError] = useState(null);

  const vp = stock.value_play_json || {};
  const pillars = vp.pillars || {};
  const metrics = vp.metrics || {};
  const entry = vp.entry || {};
  const exit = vp.exit || {};

  const grade = stock.value_play_grade || vp.grade || "?";
  const classification = stock.value_play_class || vp.classification;
  const score = Number(stock.value_play_score || vp.valuePlayScore || 0);

  const convictionClass =
    entry.conviction === "HIGH"
      ? styles.convictionHigh
      : entry.conviction === "MEDIUM"
        ? styles.convictionMedium
        : styles.convictionLow;

  async function handleAiAnalysis(e) {
    e.preventDefault();
    e.stopPropagation();
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/value-plays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: stock.ticker_code }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Analysis failed");
      setAiAnalysis(data.analysis);
      setAiExpanded(true);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  const rec = aiAnalysis ? REC_COLORS[aiAnalysis.recommendation] || REC_COLORS.HOLD : null;

  return (
    <div className={styles.card}>
      {/* Clickable overlay */}
      <Link
        href={`/scanner/${stock.ticker_code}?view=value-play`}
        className={styles.cardLink}
        aria-label={`View details for ${stock.ticker_code}`}
      />

      {/* Header */}
      <div className={`${styles.header} ${styles.cardInteractive}`} style={{ pointerEvents: "none" }}>
        <div className={styles.headerLeft}>
          <div className={styles.ticker}>{stock.ticker_code}</div>
          <div className={styles.name}>{stock.short_name || stock.ticker_code}</div>
          <div className={styles.sector}>{formatSector(stock.sector)}</div>
        </div>
        <div className={styles.badges}>
          <span
            className={styles.gradeBadge}
            style={{ background: gradeBg(grade), color: gradeColor(grade) }}
          >
            {grade}
          </span>
          {classification && (
            <span
              className={styles.classBadge}
              style={{
                background: classificationBg(classification),
                color: classificationColor(classification),
                borderColor: classificationColor(classification),
              }}
            >
              {classificationLabel(classification)}
            </span>
          )}
        </div>
      </div>

      {/* Score bar + pillar bars */}
      <div className={`${styles.scoreSection} ${styles.cardInteractive}`} style={{ pointerEvents: "none" }}>
        <div className={styles.scoreBar}>
          <span className={styles.scoreBarLabel}>Score</span>
          <div className={styles.scoreBarTrack}>
            <div
              className={styles.scoreBarFill}
              style={{
                width: `${Math.min(score, 100)}%`,
                background: gradeColor(grade),
              }}
            />
          </div>
          <span className={styles.scoreBarValue} style={{ color: gradeColor(grade) }}>
            {score}/100
          </span>
        </div>
        <div className={styles.pillars}>
          {[
            { key: "intrinsicValue", label: "Intrinsic" },
            { key: "quality", label: "Quality" },
            { key: "safetyMargin", label: "Safety" },
            { key: "catalyst", label: "Catalyst" },
          ].map(({ key, label }) => {
            const val = pillars[key] || 0;
            return (
              <div className={styles.pillar} key={key}>
                <span className={styles.pillarLabel}>{label}</span>
                <div className={styles.pillarTrack}>
                  <div
                    className={styles.pillarFill}
                    style={{
                      width: `${(val / 25) * 100}%`,
                      background: pillarColor(val),
                    }}
                  />
                </div>
                <span className={styles.pillarValue} style={{ color: pillarColor(val) }}>
                  {val}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Metrics grid */}
      <div className={`${styles.metricsGrid} ${styles.cardInteractive}`} style={{ pointerEvents: "none" }}>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>PE</span>
          <span className={styles.metricValue} style={{ color: valuationColor(metrics.peRatio, "pe") }}>
            {fmt(metrics.peRatio, "x")}
          </span>
        </div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>PB</span>
          <span className={styles.metricValue} style={{ color: valuationColor(metrics.pbRatio, "pb") }}>
            {fmt(metrics.pbRatio, "x")}
          </span>
        </div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>EV/EBITDA</span>
          <span className={styles.metricValue} style={{ color: valuationColor(metrics.evToEbitda, "evEbitda") }}>
            {fmt(metrics.evToEbitda, "x")}
          </span>
        </div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>FCF Yld</span>
          <span className={styles.metricValue} style={{ color: valuationColor(metrics.fcfYield, "yield") }}>
            {fmt(metrics.fcfYield, "%")}
          </span>
        </div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>Div%</span>
          <span className={styles.metricValue} style={{ color: valuationColor(metrics.dividendYield, "yield") }}>
            {fmt(metrics.dividendYield, "%")}
          </span>
        </div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>Div Gr</span>
          <span className={styles.metricValue} style={{ color: valuationColor(metrics.dividendGrowth5yr, "yield") }}>
            {fmt(metrics.dividendGrowth5yr, "%")}
          </span>
        </div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>D/E</span>
          <span className={styles.metricValue} style={{ color: valuationColor(metrics.debtEquity, "de") }}>
            {fmt(metrics.debtEquity, "x")}
          </span>
        </div>
        <div className={styles.metricItem}>
          <span className={styles.metricLabel}>ROE</span>
          <span className={styles.metricValue} style={{ color: valuationColor(metrics.impliedROE, "yield") }}>
            {fmt(metrics.impliedROE, "%")}
          </span>
        </div>
      </div>

      {/* Reasoning */}
      <div className={`${styles.reasoning} ${styles.cardInteractive}`} style={{ pointerEvents: "none" }}>
        {vp.thesis && (
          <div className={styles.reasoningRow}>
            <span className={styles.reasoningLabel}>Thesis</span>
            <span className={styles.reasoningText}>{vp.thesis}</span>
          </div>
        )}
        {vp.risks && vp.risks.length > 0 && (
          <div className={styles.reasoningRow}>
            <span className={styles.reasoningLabel}>Risks</span>
            <div className={styles.risksList}>
              {vp.risks.map((r, i) => (
                <span key={i} className={styles.riskTag}>{r}</span>
              ))}
            </div>
          </div>
        )}
        {vp.catalyst && (
          <div className={styles.reasoningRow}>
            <span className={styles.reasoningLabel}>Catalyst</span>
            <span className={styles.reasoningText}>{vp.catalyst}</span>
          </div>
        )}
        {vp.timeHorizon && (
          <div className={styles.reasoningRow}>
            <span className={styles.reasoningLabel}>Horizon</span>
            <span className={styles.reasoningText}>{vp.timeHorizon}</span>
          </div>
        )}
      </div>

      {/* Entry / Exit */}
      {entry.approach && (
        <div className={`${styles.entryExit} ${styles.cardInteractive}`} style={{ pointerEvents: "none" }}>
          <div className={styles.entryRow}>
            <span className={styles.entryLabel}>Entry</span>
            <span className={styles.entryText}>{entry.approach}</span>
          </div>
          <div className={styles.entryRow}>
            <span className={styles.entryLabel}>Conviction</span>
            <span className={`${styles.convictionBadge} ${convictionClass}`}>
              {entry.conviction}
            </span>
          </div>
          {exit.triggers && exit.triggers.length > 0 && (
            <div className={styles.entryRow}>
              <span className={styles.entryLabel}>Exit</span>
              <div className={styles.exitTags}>
                {exit.triggers.slice(0, 3).map((t, i) => (
                  <span key={i} className={styles.exitTag}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Deep-Dive Section */}
      <div className={`${styles.aiSection} ${styles.cardInteractive}`}>
        {aiAnalysis ? (
          <>
            <div className={styles.aiHeader}>
              <span
                className={styles.aiRecBadge}
                style={{ background: rec.bg, color: rec.color, borderColor: rec.border }}
              >
                {aiAnalysis.recommendation.replace("_", " ")}
              </span>
              <span className={styles.aiReason}>{aiAnalysis.recommendation_reason}</span>
              <button
                className={styles.aiExpandBtn}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAiExpanded(!aiExpanded); }}
              >
                {aiExpanded ? "\u25B2" : "\u25BC"}
              </button>
            </div>
            {aiExpanded && (
              <div className={styles.aiDetail}>
                <div className={styles.aiDetailRow}>
                  <span className={styles.aiDetailLabel}>Company</span>
                  <span className={styles.aiDetailText}>{aiAnalysis.company_overview}</span>
                </div>
                <div className={styles.aiDetailRow}>
                  <span className={styles.aiDetailLabel}>Value Thesis</span>
                  <span className={styles.aiDetailText}>{aiAnalysis.value_thesis}</span>
                </div>
                <div className={styles.aiDetailRow}>
                  <span className={styles.aiDetailLabel}>Risks</span>
                  <span className={styles.aiDetailText}>{aiAnalysis.risk_assessment}</span>
                </div>
                <div className={styles.aiDetailRow}>
                  <span className={styles.aiDetailLabel}>Catalysts</span>
                  <span className={styles.aiDetailText}>{aiAnalysis.catalyst_analysis}</span>
                </div>
                <div className={styles.aiDetailRow}>
                  <span className={styles.aiDetailLabel}>News Impact</span>
                  <span className={styles.aiDetailText}>{aiAnalysis.news_impact}</span>
                </div>
                <div className={styles.aiMetaRow}>
                  <span className={styles.aiMetaItem}>
                    Fair Value: <strong>{aiAnalysis.fair_value_estimate}</strong>
                  </span>
                  <span className={styles.aiMetaItem}>
                    Horizon: <strong>{aiAnalysis.time_horizon}</strong>
                  </span>
                  <span className={styles.aiMetaItem}>
                    Confidence: <strong>{aiAnalysis.confidence}%</strong>
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <button
            className={styles.analyzeBtn}
            onClick={handleAiAnalysis}
            disabled={aiLoading}
          >
            {aiLoading ? (
              <>
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                Analyzing...
              </>
            ) : (
              "Analyze with AI"
            )}
          </button>
        )}
        {aiError && <div className={styles.aiError}>{aiError}</div>}
      </div>

      {/* Footer */}
      <div className={`${styles.footer} ${styles.cardInteractive}`}>
        {isAdded ? (
          <span className={styles.addedCheck} title="Added to portfolio">&#10003;</span>
        ) : (
          <button
            className={styles.addBtn}
            title="Add to portfolio"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAddClick?.(stock); }}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
