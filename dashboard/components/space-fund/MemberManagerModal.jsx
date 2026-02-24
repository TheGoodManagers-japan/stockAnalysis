"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Modal from "../ui/Modal";
import styles from "./SpaceFund.module.css";

export default function MemberManagerModal({ isOpen, onClose, onMembersChanged }) {
  const [memberForm, setMemberForm] = useState({
    ticker_code: "", short_name: "", currency: "USD", exchange: "US",
    target_weight: "", category: "Launch",
  });
  const [allMembers, setAllMembers] = useState([]);

  const fetchAllMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/space-fund/members");
      const data = await res.json();
      if (data.success) setAllMembers(data.members);
    } catch (err) {
      console.error("Failed to fetch members:", err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchAllMembers();
  }, [isOpen, fetchAllMembers]);

  const totalWeight = useMemo(() => {
    return allMembers
      .filter((m) => m.is_active)
      .reduce((sum, m) => sum + Number(m.target_weight) * 100, 0);
  }, [allMembers]);

  async function handleAddMember(e) {
    e.preventDefault();
    try {
      const res = await fetch("/api/space-fund/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...memberForm,
          target_weight: Number(memberForm.target_weight) / 100,
        }),
      });
      if (res.ok) {
        setMemberForm({ ticker_code: "", short_name: "", currency: "USD", exchange: "US", target_weight: "", category: "Launch" });
        fetchAllMembers();
        onMembersChanged();
      }
    } catch (err) {
      console.error("Failed to add member:", err);
    }
  }

  async function handleToggleMember(ticker, isActive) {
    try {
      await fetch("/api/space-fund/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker_code: ticker, is_active: !isActive }),
      });
      fetchAllMembers();
      onMembersChanged();
    } catch (err) {
      console.error("Failed to toggle member:", err);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Manage Fund Members">
      {/* Weight validation */}
      {Math.abs(totalWeight - 100) > 0.1 && (
        <div className={styles.weightWarning}>
          Target weights sum to {totalWeight.toFixed(1)}% — should be 100%.
        </div>
      )}

      {/* Add member form */}
      <form onSubmit={handleAddMember} className={styles.memberForm}>
        <div>
          <label>Ticker</label>
          <input value={memberForm.ticker_code} onChange={(e) => setMemberForm((f) => ({ ...f, ticker_code: e.target.value }))} placeholder="RKLB" required style={{ width: "100%" }} />
        </div>
        <div>
          <label>Name</label>
          <input value={memberForm.short_name} onChange={(e) => setMemberForm((f) => ({ ...f, short_name: e.target.value }))} placeholder="Rocket Lab" style={{ width: "100%" }} />
        </div>
        <div>
          <label>Weight %</label>
          <input type="number" step="0.1" value={memberForm.target_weight} onChange={(e) => setMemberForm((f) => ({ ...f, target_weight: e.target.value }))} placeholder="15" required style={{ width: "100%" }} />
        </div>
        <div>
          <label>Currency</label>
          <select value={memberForm.currency} onChange={(e) => setMemberForm((f) => ({ ...f, currency: e.target.value, exchange: e.target.value === "JPY" ? "JPX" : "US" }))} style={{ width: "100%" }}>
            <option value="USD">USD</option>
            <option value="JPY">JPY</option>
          </select>
        </div>
        <div>
          <label>Category</label>
          <select value={memberForm.category} onChange={(e) => setMemberForm((f) => ({ ...f, category: e.target.value }))} style={{ width: "100%" }}>
            <option value="Launch">Launch</option>
            <option value="Satellite">Satellite</option>
            <option value="Defense">Defense</option>
            <option value="Infrastructure">Infrastructure</option>
            <option value="ETF">ETF</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "end" }}>
          <button type="submit" className="btn btn-primary btn-sm">Add</button>
        </div>
      </form>

      {/* Existing members */}
      <div className="card-title mb-md" style={{ fontSize: "0.85rem" }}>Current Members ({allMembers.length})</div>
      {allMembers.length === 0 ? (
        <p className="text-muted">No members yet.</p>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Name</th>
                <th>Weight</th>
                <th>Category</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {allMembers.map((m) => (
                <tr key={m.ticker_code} style={{ opacity: m.is_active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 600 }}>{m.ticker_code}</td>
                  <td>{m.short_name || "-"}</td>
                  <td className="text-mono">{(Number(m.target_weight) * 100).toFixed(1)}%</td>
                  <td>{m.category ? <span className={styles.categoryBadge}>{m.category}</span> : "-"}</td>
                  <td>
                    <span className={`badge ${m.is_active ? "badge-buy" : "badge-neutral"}`} style={{ fontSize: "0.65rem" }}>
                      {m.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => handleToggleMember(m.ticker_code, m.is_active)}>
                      {m.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
