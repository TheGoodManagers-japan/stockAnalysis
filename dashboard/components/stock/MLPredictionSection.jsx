"use client";

import { useState } from "react";

export default function MLPredictionSection({ tickerCode, initialPrediction, currentPrice }) {
  const [prediction, setPrediction] = useState(initialPrediction);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleCalculate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/predictions/calculate?ticker=${tickerCode}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success && data.prediction) {
        setPrediction(data.prediction);
      } else if (data.skipReason) {
        setPrediction({ skip_reason: data.skipReason, prediction_date: new Date().toISOString() });
      } else {
        setError(data.error || "Prediction failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title mb-md">
        ML Price Forecast
        {prediction?.model_type && !prediction.skip_reason && (
          <span className="text-muted" style={{ fontSize: "0.72rem", fontWeight: 400, marginLeft: 8 }}>
            {prediction.model_type.toUpperCase()} v{prediction.model_version || "?"}
          </span>
        )}
      </div>
      {prediction && prediction.skip_reason ? (
        <div style={{ padding: "4px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ color: "var(--accent-yellow)", fontSize: "0.85rem", fontWeight: 600 }}>
              Prediction Skipped
            </span>
          </div>
          <p className="text-muted" style={{ fontSize: "0.82rem", lineHeight: 1.5, margin: 0 }}>
            {prediction.skip_reason}
          </p>
          <div className="text-muted" style={{ fontSize: "0.72rem", marginTop: 8 }}>
            Date: {String(prediction.prediction_date).split("T")[0]}
          </div>
        </div>
      ) : prediction ? (
        <div style={{ display: "grid", gap: 10 }}>
          {prediction.predicted_max_5d ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {[
                { label: "5d", max: prediction.predicted_max_5d, unc: prediction.uncertainty_5d },
                { label: "10d", max: prediction.predicted_max_10d, unc: prediction.uncertainty_10d },
                { label: "20d", max: prediction.predicted_max_20d, unc: prediction.uncertainty_20d },
                { label: "30d", max: prediction.predicted_max_30d, unc: prediction.uncertainty_30d },
              ].map(({ label, max, unc }) => {
                const maxVal = Number(max);
                const currentVal = Number(prediction.current_price || currentPrice);
                const pct = currentVal > 0 ? ((maxVal - currentVal) / currentVal) * 100 : 0;
                const uncVal = Number(unc) || 0;
                return (
                  <div
                    key={label}
                    style={{
                      background: "var(--bg-primary)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      textAlign: "center",
                    }}
                  >
                    <div className="text-muted" style={{ fontSize: "0.68rem", marginBottom: 4 }}>{label}</div>
                    <div className="text-mono" style={{ fontWeight: 600, color: "var(--accent-blue)", fontSize: "0.85rem" }}>
                      {Math.round(maxVal).toLocaleString()}
                    </div>
                    <div
                      className="text-mono"
                      style={{
                        fontSize: "0.75rem",
                        color: pct >= 0 ? "var(--accent-green)" : "var(--accent-red)",
                      }}
                    >
                      {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                    </div>
                    {uncVal > 0 && (
                      <div className="text-muted" style={{ fontSize: "0.62rem", marginTop: 2 }}>
                        ±{uncVal.toFixed(1)}%
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div className="flex-between">
                <span className="text-secondary">Predicted Max (30d)</span>
                <span className="text-mono" style={{ fontWeight: 600, color: "var(--accent-blue)" }}>
                  {Number(prediction.predicted_max_30d).toLocaleString()}
                </span>
              </div>
              <div className="flex-between">
                <span className="text-secondary">Expected Change</span>
                <span
                  className="text-mono"
                  style={{
                    fontWeight: 600,
                    color: Number(prediction.predicted_pct_change) >= 0 ? "var(--accent-green)" : "var(--accent-red)",
                  }}
                >
                  {Number(prediction.predicted_pct_change) >= 0 ? "+" : ""}
                  {Number(prediction.predicted_pct_change).toFixed(1)}%
                </span>
              </div>
            </>
          )}
          <div>
            <div className="flex-between mb-sm">
              <span className="text-secondary">Confidence</span>
              <span className="text-mono" style={{ fontSize: "0.85rem" }}>
                {(Number(prediction.confidence) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="score-bar-track">
              <div
                className="score-bar-fill"
                style={{
                  width: `${Number(prediction.confidence) * 100}%`,
                  background: "var(--accent-blue)",
                }}
              />
            </div>
          </div>
          <div className="text-muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>
            Prediction date: {String(prediction.prediction_date).split("T")[0]}
          </div>
        </div>
      ) : (
        <div>
          <button
            onClick={handleCalculate}
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
                <span>Calculating...</span>
              </>
            ) : (
              <span>Calculate Prediction</span>
            )}
          </button>
          {error && (
            <p style={{ color: "var(--accent-red)", fontSize: "0.82rem", marginTop: 8 }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
