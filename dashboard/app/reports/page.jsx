"use client";

import { useState } from "react";
import ScanDiffSection from "../../components/reports/ScanDiffSection";
import SignalTrackingSection from "../../components/reports/SignalTrackingSection";
import InsightsSection from "../../components/reports/InsightsSection";
import DailyReportsSection from "../../components/reports/DailyReportsSection";
import styles from "../../components/reports/ReportsTabs.module.css";

const TABS = [
  { key: "daily", label: "Daily Reports" },
  { key: "tracking", label: "Signal Tracking" },
  { key: "diff", label: "Scan Diff" },
  { key: "insights", label: "Insights" },
];

export default function ReportsPage() {
  const [tab, setTab] = useState("daily");
  const [days, setDays] = useState(90);

  return (
    <>
      <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>
        Scan Reports
      </h2>

      {/* Tab navigation */}
      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab}${tab === t.key ? ` ${styles.active}` : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared filter bar */}
      <div className={styles.filterBar}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
          Period:
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-primary)",
              borderRadius: "6px",
              padding: "5px 8px",
              fontSize: "0.82rem",
              fontFamily: "inherit",
            }}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
        </label>
      </div>

      {/* Tab content */}
      {tab === "daily" && <DailyReportsSection days={days} />}
      {tab === "tracking" && <SignalTrackingSection days={days} />}
      {tab === "diff" && <ScanDiffSection />}
      {tab === "insights" && <InsightsSection days={days} />}
    </>
  );
}
