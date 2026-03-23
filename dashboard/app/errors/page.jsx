"use client";

import { useState, useEffect, useCallback } from "react";

const SEVERITY_COLORS = {
  critical: "var(--accent-red)",
  error: "var(--accent-orange)",
  warning: "var(--accent-yellow)",
};

export default function ErrorsPage() {
  const [errors, setErrors] = useState([]);
  const [total, setTotal] = useState(0);
  const [unackCount, setUnackCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [filters, setFilters] = useState({
    severity: "",
    source: "",
    acknowledged: "false",
  });

  const fetchErrors = useCallback(async () => {
    const params = new URLSearchParams({ limit: "200" });
    if (filters.severity) params.set("severity", filters.severity);
    if (filters.source) params.set("source", filters.source);
    if (filters.acknowledged) params.set("acknowledged", filters.acknowledged);

    try {
      const res = await fetch(`/api/errors?${params}`);
      const data = await res.json();
      if (data.success) {
        setErrors(data.errors);
        setTotal(data.total);
        setUnackCount(data.unacknowledgedCount);
      }
    } catch (err) {
      console.error("Failed to fetch errors:", err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchErrors();
    const timer = setInterval(fetchErrors, 30000);
    return () => clearInterval(timer);
  }, [fetchErrors]);

  const handleAcknowledge = async (ids) => {
    try {
      await fetch("/api/errors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, acknowledged: true }),
      });
      setSelected(new Set());
      fetchErrors();
    } catch (err) {
      console.error("Failed to acknowledge:", err);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Delete ALL errors permanently?")) return;
    try {
      await fetch("/api/errors", { method: "DELETE" });
      setSelected(new Set());
      fetchErrors();
    } catch (err) {
      console.error("Failed to clear:", err);
    }
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === errors.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(errors.map((e) => e.id)));
    }
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const uniqueSources = [...new Set(errors.map((e) => e.source))].sort();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-heading)", margin: 0 }}>
            Error Log
          </h1>
          <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            {total} total{unackCount > 0 && ` · ${unackCount} unacknowledged`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {selected.size > 0 && (
            <button
              onClick={() => handleAcknowledge([...selected])}
              style={{
                background: "transparent",
                border: "1px solid var(--accent-blue)",
                color: "var(--accent-blue)",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Acknowledge ({selected.size})
            </button>
          )}
          {unackCount > 0 && (
            <button
              onClick={() => handleAcknowledge("all")}
              style={{
                background: "transparent",
                border: "1px solid var(--accent-green)",
                color: "var(--accent-green)",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Acknowledge All
            </button>
          )}
          {total > 0 && (
            <button
              onClick={handleClearAll}
              style={{
                background: "transparent",
                border: "1px solid var(--accent-red)",
                color: "var(--accent-red)",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: "0.78rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", flexWrap: "wrap" }}>
        <select
          value={filters.severity}
          onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-primary)",
            color: "var(--text-primary)",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: "0.82rem",
          }}
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
        </select>

        <input
          type="text"
          placeholder="Filter by source..."
          value={filters.source}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-primary)",
            color: "var(--text-primary)",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: "0.82rem",
            width: 200,
          }}
        />

        <select
          value={filters.acknowledged}
          onChange={(e) => setFilters((f) => ({ ...f, acknowledged: e.target.value }))}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-primary)",
            color: "var(--text-primary)",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: "0.82rem",
          }}
        >
          <option value="false">Unacknowledged</option>
          <option value="true">Acknowledged</option>
          <option value="">All</option>
        </select>

        {uniqueSources.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginLeft: 8 }}>
            {uniqueSources.slice(0, 8).map((src) => (
              <button
                key={src}
                onClick={() => setFilters((f) => ({ ...f, source: f.source === src ? "" : src }))}
                style={{
                  background: filters.source === src ? "var(--accent-blue-dim)" : "var(--bg-tertiary)",
                  border: "1px solid var(--border-primary)",
                  color: filters.source === src ? "var(--accent-blue)" : "var(--text-muted)",
                  padding: "3px 8px",
                  borderRadius: 4,
                  fontSize: "0.72rem",
                  cursor: "pointer",
                }}
              >
                {src}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <span className="spinner" />
        </div>
      ) : errors.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 60 }}>
          <div style={{ color: "var(--accent-green)", fontSize: "1.5rem", marginBottom: 8 }}>&#10003;</div>
          <div style={{ color: "var(--text-muted)" }}>No errors found.</div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={selected.size === errors.length && errors.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ width: 80 }}>Severity</th>
                <th style={{ width: 140 }}>Time</th>
                <th style={{ width: 180 }}>Source</th>
                <th>Message</th>
                <th style={{ width: 60 }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((err) => (
                <>
                  <tr
                    key={err.id}
                    style={{
                      cursor: "pointer",
                      opacity: err.is_acknowledged ? 0.5 : 1,
                    }}
                    onClick={() => setExpandedId(expandedId === err.id ? null : err.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(err.id)}
                        onChange={() => toggleSelect(err.id)}
                      />
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: "0.72rem",
                          fontWeight: 600,
                          color: SEVERITY_COLORS[err.severity] || "var(--text-secondary)",
                          background: `color-mix(in srgb, ${SEVERITY_COLORS[err.severity] || "var(--text-secondary)"} 15%, transparent)`,
                        }}
                      >
                        {err.severity}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.78rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {formatTime(err.created_at)}
                    </td>
                    <td>
                      <span style={{ fontSize: "0.78rem", color: "var(--accent-blue)", fontWeight: 500 }}>
                        {err.source}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.82rem", color: "var(--text-primary)", maxWidth: 400 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {err.message}
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {(err.stack || err.details_json) && (
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          {expandedId === err.id ? "▲" : "▼"}
                        </span>
                      )}
                    </td>
                  </tr>
                  {expandedId === err.id && (
                    <tr key={`${err.id}-detail`}>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <div
                          style={{
                            background: "var(--bg-tertiary)",
                            padding: "12px 16px",
                            borderTop: "1px solid var(--border-primary)",
                            borderBottom: "1px solid var(--border-primary)",
                          }}
                        >
                          <div style={{ fontSize: "0.82rem", color: "var(--text-primary)", marginBottom: 8, wordBreak: "break-word" }}>
                            {err.message}
                          </div>
                          {err.stack && (
                            <pre
                              style={{
                                fontSize: "0.72rem",
                                color: "var(--text-muted)",
                                margin: "8px 0",
                                padding: 10,
                                background: "var(--bg-secondary)",
                                borderRadius: 6,
                                overflowX: "auto",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                maxHeight: 300,
                              }}
                            >
                              {err.stack}
                            </pre>
                          )}
                          {err.details_json && (
                            <pre
                              style={{
                                fontSize: "0.72rem",
                                color: "var(--text-muted)",
                                margin: "8px 0",
                                padding: 10,
                                background: "var(--bg-secondary)",
                                borderRadius: 6,
                                overflowX: "auto",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {JSON.stringify(err.details_json, null, 2)}
                            </pre>
                          )}
                          {!err.is_acknowledged && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAcknowledge([err.id]);
                              }}
                              style={{
                                background: "transparent",
                                border: "1px solid var(--border-secondary)",
                                color: "var(--text-secondary)",
                                padding: "4px 12px",
                                borderRadius: 6,
                                fontSize: "0.72rem",
                                fontWeight: 600,
                                cursor: "pointer",
                                marginTop: 4,
                              }}
                            >
                              Acknowledge
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
