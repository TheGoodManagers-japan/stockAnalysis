"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import TabBar from "../../components/ui/TabBar";
import DCAPlannerTab from "../../components/space-fund/DCAPlannerTab";
import RebalanceTab from "../../components/space-fund/RebalanceTab";
import SpaceFundNewsTab from "../../components/space-fund/SpaceFundNewsTab";
import MemberManagerModal from "../../components/space-fund/MemberManagerModal";
import TransactionForm from "../../components/space-fund/TransactionForm";

const SpaceFundOverview = dynamic(
  () => import("../../components/space-fund/SpaceFundOverview"),
  {
    ssr: false,
    loading: () => <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>,
  }
);

const PerformanceTab = dynamic(
  () => import("../../components/space-fund/PerformanceTab"),
  {
    ssr: false,
    loading: () => <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>,
  }
);

const TABS = ["Overview", "DCA Planner", "Rebalance", "Performance", "News"];

export default function SpaceFundPage() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [fund, setFund] = useState(null);
  const [members, setMembers] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTxForm, setShowTxForm] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);

  // ---- Shared data fetching ----

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/space-fund");
      const data = await res.json();
      if (data.success) {
        setFund(data.fund);
        setMembers(data.members);
      }
    } catch (err) {
      console.error("Failed to fetch fund overview:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await fetch("/api/space-fund/snapshots");
      const data = await res.json();
      if (data.success) setSnapshots(data.snapshots);
    } catch (err) {
      console.error("Failed to fetch snapshots:", err);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      const res = await fetch("/api/space-fund/transactions?limit=20");
      const data = await res.json();
      if (data.success) setTransactions(data.transactions);
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    fetchSnapshots();
    fetchTransactions();
  }, [fetchOverview, fetchSnapshots, fetchTransactions]);

  async function handleTakeSnapshot() {
    try {
      await fetch("/api/space-fund/snapshots", { method: "POST" });
      fetchSnapshots();
    } catch (err) {
      console.error("Failed to take snapshot:", err);
    }
  }

  // ---- Render ----

  return (
    <>
      <div className="flex-between mb-lg">
        <h2 style={{ color: "var(--text-heading)" }}>Space Fund</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" onClick={() => setShowTxForm((v) => !v)}>
            {showTxForm ? "Cancel" : "+ Transaction"}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowMemberModal(true)}>
            Manage Members
          </button>
        </div>
      </div>

      {showTxForm && (
        <TransactionForm
          members={members}
          onSubmitted={() => { setShowTxForm(false); fetchOverview(); fetchTransactions(); }}
          onCancel={() => setShowTxForm(false)}
        />
      )}

      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "Overview" && (
        <SpaceFundOverview fund={fund} members={members} transactions={transactions} loading={loading} />
      )}
      {activeTab === "DCA Planner" && <DCAPlannerTab />}
      {activeTab === "Rebalance" && <RebalanceTab />}
      {activeTab === "Performance" && (
        <PerformanceTab fund={fund} snapshots={snapshots} transactions={transactions} onTakeSnapshot={handleTakeSnapshot} />
      )}
      {activeTab === "News" && <SpaceFundNewsTab />}

      <MemberManagerModal
        isOpen={showMemberModal}
        onClose={() => setShowMemberModal(false)}
        onMembersChanged={fetchOverview}
      />
    </>
  );
}
