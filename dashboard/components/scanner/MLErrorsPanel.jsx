"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatNum } from "../../lib/uiHelpers";

export default function MLErrorsPanel({ errors }) {
  const router = useRouter();
  const [retryStates, setRetryStates] = useState({});

  const handleRetry = useCallback(async (ticker) => {
    setRetryStates((prev) => ({ ...prev, [ticker]: "loading" }));
    try {
      const res = await fetch(`/api/predictions/calculate?ticker=${ticker}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setRetryStates((prev) => ({ ...prev, [ticker]: "success" }));
      } else {
        setRetryStates((prev) => ({
          ...prev,
          [ticker]: `error:${data.skipReason || data.error || "Unknown error"}`,
        }));
      }
    } catch (err) {
      setRetryStates((prev) => ({
        ...prev,
        [ticker]: `error:${err.message}`,
      }));
    }
  }, []);

  const handleRetryAll = useCallback(async () => {
    const tickers = errors
      .filter((r) => retryStates[r.ticker_code] !== "success")
      .map((r) => r.ticker_code);
    for (const ticker of tickers) {
      await handleRetry(ticker);
    }
  }, [errors, retryStates, handleRetry]);

  if (errors.length === 0) {
    return (
      <div
        className="card"
        style={{ textAlign: "center", padding: 40 }}
      >
        <div
          style={{
            color: "var(--accent-green)",
            fontSize: "1.5rem",
            marginBottom: 8,
          }}
        >
          &#10003;
        </div>
        <div className="text-muted">
          All buy signals have ML predictions. No errors.
        </div>
      </div>
    );
  }

  const resolvedCount = Object.values(retryStates).filter(
    (s) => s === "success"
  ).length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {errors.length} buy signal{errors.length !== 1 ? "s" : ""} missing ML
          predictions
          {resolvedCount > 0 && (
            <span style={{ color: "var(--accent-green)", marginLeft: 8 }}>
              ({resolvedCount} resolved)
            </span>
          )}
        </span>
        <button
          onClick={handleRetryAll}
          style={{
            background: "transparent",
            border: "1px solid var(--accent-blue)",
            color: "var(--accent-blue)",
            padding: "6px 14px",
            borderRadius: "6px",
            fontSize: "0.78rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Retry All
        </button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Price</th>
              <th>Trigger</th>
              <th>Error Reason</th>
              <th>ML Date</th>
              <th style={{ width: 90 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {errors.map((r) => {
              const state = retryStates[r.ticker_code];
              const errorReason = r.ml_skip_reason || "No prediction generated";
              return (
                <tr
                  key={r.ticker_code}
                  style={{ cursor: "pointer" }}
                  onClick={() => router.push(`/scanner/${r.ticker_code}`)}
                >
                  <td>
                    <div
                      style={{
                        fontWeight: 600,
                        color: "var(--accent-blue)",
                      }}
                    >
                      {r.ticker_code}
                    </div>
                    {r.short_name && (
                      <div
                        style={{
                          fontSize: "0.72rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {r.short_name}
                      </div>
                    )}
                  </td>
                  <td className="text-mono">{formatNum(r.current_price)}</td>
                  <td>
                    {r.trigger_type && (
                      <span
                        className="badge badge-buy"
                        style={{ fontSize: "0.7rem" }}
                      >
                        {r.trigger_type}
                      </span>
                    )}
                  </td>
                  <td>
                    {state === "success" ? (
                      <span
                        style={{
                          color: "var(--accent-green)",
                          fontWeight: 600,
                          fontSize: "0.82rem",
                        }}
                      >
                        &#10003; Resolved
                      </span>
                    ) : state?.startsWith("error:") ? (
                      <span
                        style={{
                          color: "var(--accent-red)",
                          fontSize: "0.78rem",
                        }}
                      >
                        {state.slice(6)}
                      </span>
                    ) : (
                      <span
                        style={{
                          color: "var(--accent-red)",
                          fontSize: "0.78rem",
                        }}
                      >
                        {errorReason}
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    {r.ml_prediction_date
                      ? new Date(r.ml_prediction_date).toLocaleDateString(
                          "ja-JP"
                        )
                      : "Never"}
                  </td>
                  <td>
                    <button
                      disabled={state === "loading" || state === "success"}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetry(r.ticker_code);
                      }}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border-secondary)",
                        color: state === "success" ? "var(--accent-green)" : "var(--text-secondary)",
                        padding: "4px 12px",
                        borderRadius: "6px",
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        cursor:
                          state === "loading" || state === "success"
                            ? "default"
                            : "pointer",
                        opacity: state === "success" ? 0.6 : 1,
                      }}
                    >
                      {state === "loading" ? (
                        <span
                          className="spinner"
                          style={{
                            width: 12,
                            height: 12,
                            borderWidth: 2,
                          }}
                        />
                      ) : state === "success" ? (
                        "Done"
                      ) : (
                        "Retry"
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
