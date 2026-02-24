"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import TabBar from "../../components/ui/TabBar";
import SignalTable from "../../components/signal-tracker/SignalTable";
import styles from "../../components/signal-tracker/SignalTracker.module.css";

const SignalOverview = dynamic(
  () => import("../../components/signal-tracker/SignalOverview"),
  {
    ssr: false,
    loading: () => <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>,
  }
);

const SignalAnalytics = dynamic(
  () => import("../../components/signal-tracker/SignalAnalytics"),
  {
    ssr: false,
    loading: () => <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>,
  }
);

const TABS = ["Overview", "Scanner", "Value Plays", "Space Fund", "Analytics"];

export default function SignalTrackerPage() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [stats, setStats] = useState(null);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolveMsg, setResolveMsg] = useState("");

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/signal-tracker/stats");
      const data = await res.json();
      if (data.success) setStats(data);
    } catch (err) {
      console.error("Failed to fetch signal stats:", err);
    }
  }, []);

  const fetchTrades = useCallback(async (source) => {
    try {
      const params = new URLSearchParams({ limit: "500" });
      if (source) params.set("source", source);
      const res = await fetch(`/api/signal-tracker?${params}`);
      const data = await res.json();
      if (data.success) setTrades(data.trades);
    } catch (err) {
      console.error("Failed to fetch signal trades:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchTrades();
  }, [fetchStats, fetchTrades]);

  // Refetch trades when switching source tabs
  useEffect(() => {
    const sourceMap = {
      Scanner: "scanner",
      "Value Plays": "value_play",
      "Space Fund": "space_fund",
    };
    const source = sourceMap[activeTab];
    if (source) {
      setLoading(true);
      fetchTrades(source);
    } else if (activeTab === "Overview" || activeTab === "Analytics") {
      fetchTrades();
    }
  }, [activeTab, fetchTrades]);

  async function handleResolve() {
    setResolving(true);
    setResolveMsg("");
    try {
      const res = await fetch("/api/signal-tracker/resolve", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setResolveMsg(`Checked ${data.checked} tickers, resolved ${data.resolved} trades`);
        // Refresh data
        fetchStats();
        const sourceMap = {
          Scanner: "scanner",
          "Value Plays": "value_play",
          "Space Fund": "space_fund",
        };
        fetchTrades(sourceMap[activeTab]);
      } else {
        setResolveMsg(`Error: ${data.error}`);
      }
    } catch (err) {
      setResolveMsg(`Failed: ${err.message}`);
    } finally {
      setResolving(false);
    }
  }

  const sourceMap = {
    Scanner: "scanner",
    "Value Plays": "value_play",
    "Space Fund": "space_fund",
  };
  const currentSource = sourceMap[activeTab];
  const filteredTrades = currentSource
    ? trades.filter((t) => t.source === currentSource)
    : trades;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Signal Performance Tracker</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {resolveMsg && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              {resolveMsg}
            </span>
          )}
          <button
            className={styles.resolveBtn}
            onClick={handleResolve}
            disabled={resolving}
          >
            {resolving ? "Checking..." : "Check Prices"}
          </button>
        </div>
      </div>

      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "Overview" && <SignalOverview stats={stats} />}

      {activeTab === "Scanner" && (
        <SignalTable trades={filteredTrades} source="scanner" />
      )}

      {activeTab === "Value Plays" && (
        <SignalTable trades={filteredTrades} source="value_play" />
      )}

      {activeTab === "Space Fund" && (
        <SignalTable trades={filteredTrades} source="space_fund" />
      )}

      {activeTab === "Analytics" && <SignalAnalytics stats={stats} />}
    </div>
  );
}
