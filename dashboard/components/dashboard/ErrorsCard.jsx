"use client";

import { useState } from "react";

export default function ErrorsCard({ errorCount, errors }) {
  const [open, setOpen] = useState(false);
  const hasErrors = errorCount > 0 && errors && errors.length > 0;

  return (
    <div
      className="card"
      style={{ cursor: hasErrors ? "pointer" : "default" }}
      onClick={() => hasErrors && setOpen((o) => !o)}
    >
      <div className="card-subtitle">
        Errors
        {hasErrors && (
          <span style={{ fontSize: "0.7rem", marginLeft: 6, color: "var(--text-muted)" }}>
            {open ? "▲ hide" : "▼ click to view"}
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: "1.4rem",
          fontWeight: 700,
          color: errorCount > 0 ? "var(--accent-red)" : "var(--text-heading)",
        }}
      >
        {errorCount || 0}
      </div>

      {open && errors && (
        <div
          style={{
            marginTop: 10,
            maxHeight: 200,
            overflowY: "auto",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            borderTop: "1px solid var(--border-primary)",
            paddingTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {errors.map((err, i) => (
            <div key={i} style={{ wordBreak: "break-word" }}>
              {err}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
