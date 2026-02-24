"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import TabBar from "../../components/ui/TabBar";
import PositionsTab from "../../components/portfolio/PositionsTab";
import JournalTab from "../../components/portfolio/JournalTab";
import AddPositionForm from "../../components/portfolio/AddPositionForm";

const AnalyticsTab = dynamic(
  () => import("../../components/portfolio/AnalyticsTab"),
  {
    ssr: false,
    loading: () => <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>,
  }
);

const RiskTab = dynamic(
  () => import("../../components/portfolio/RiskTab"),
  {
    ssr: false,
    loading: () => <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>,
  }
);

const TABS = ["Positions", "Analytics", "Risk", "Journal"];

export default function PortfolioPage() {
  const [activeTab, setActiveTab] = useState("Positions");
  const [holdings, setHoldings] = useState([]);
  const [closedTrades, setClosedTrades] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [journal, setJournal] = useState([]);
  const [newsAlerts, setNewsAlerts] = useState({});
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchJson = useCallback(async (url) => { try { const r = await fetch(url); return await r.json(); } catch (e) { console.error(`Fetch ${url}:`, e); return {}; } }, []);

  const fetchPortfolio = useCallback(async () => {
    const data = await fetchJson("/api/portfolio");
    if (data.success) { setHoldings(data.open || []); setClosedTrades(data.closed || []); setNewsAlerts(data.newsAlerts || {}); }
    setLoading(false);
  }, [fetchJson]);

  const fetchAnalytics = useCallback(async () => { const d = await fetchJson("/api/portfolio/analytics"); if (d.success) setAnalytics(d); }, [fetchJson]);
  const fetchSnapshots = useCallback(async () => { const d = await fetchJson("/api/portfolio/snapshots"); if (d.success) setSnapshots(d.snapshots || []); }, [fetchJson]);
  const fetchJournal = useCallback(async () => { const d = await fetchJson("/api/portfolio/journal"); if (d.success) setJournal(d.entries || []); }, [fetchJson]);

  useEffect(() => { fetchPortfolio(); fetchAnalytics(); fetchSnapshots(); fetchJournal(); }, [fetchPortfolio, fetchAnalytics, fetchSnapshots, fetchJournal]);

  const patchPortfolio = useCallback(async (body) => {
    try { await fetch("/api/portfolio", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch (e) { console.error("PATCH portfolio:", e); }
  }, []);

  async function handleAddPosition(payload) {
    try {
      const res = await fetch("/api/portfolio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) { setShowAddForm(false); fetchPortfolio(); fetchAnalytics(); }
    } catch (e) { console.error("Add position:", e); }
  }

  async function handleClosePosition(id, exitPrice, exitReason) {
    await patchPortfolio({ id, status: "closed", exit_price: exitPrice, exit_reason: exitReason, closed_at: new Date().toISOString().split("T")[0] });
    fetchPortfolio(); fetchAnalytics();
  }

  async function handleUpdateStop(id, newStop) {
    await patchPortfolio({ id, current_stop: Number(newStop) });
    fetchPortfolio();
  }

  async function handleAddJournalEntry(entry) {
    try { await fetch("/api/portfolio/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) }); fetchJournal(); }
    catch (e) { console.error("Add journal:", e); }
  }

  return (
    <>
      <div className="flex-between mb-lg">
        <h2 style={{ color: "var(--text-heading)" }}>Portfolio</h2>
        <button className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>{showAddForm ? "Cancel" : "+ Add Position"}</button>
      </div>

      {showAddForm && <AddPositionForm onSubmit={handleAddPosition} />}

      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "Positions" && <PositionsTab holdings={holdings} closedTrades={closedTrades} newsAlerts={newsAlerts} loading={loading} onUpdateStop={handleUpdateStop} onClosePosition={handleClosePosition} />}
      {activeTab === "Analytics" && <AnalyticsTab analytics={analytics} />}
      {activeTab === "Risk" && <RiskTab analytics={analytics} />}
      {activeTab === "Journal" && <JournalTab holdings={holdings} closedTrades={closedTrades} journal={journal} onAddEntry={handleAddJournalEntry} />}
    </>
  );
}
