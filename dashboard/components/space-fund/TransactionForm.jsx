"use client";

import { useState } from "react";

export default function TransactionForm({ members, onSubmitted, onCancel }) {
  const [txForm, setTxForm] = useState({
    ticker_code: "", shares: "", price_per_share: "", currency: "USD",
    transaction_type: "BUY", transaction_date: new Date().toISOString().split("T")[0],
    fees: "0", notes: "", dca_month: "",
  });

  async function handleAddTransaction(e) {
    e.preventDefault();
    try {
      const res = await fetch("/api/space-fund/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...txForm,
          shares: Number(txForm.shares),
          price_per_share: Number(txForm.price_per_share),
          fees: Number(txForm.fees) || 0,
        }),
      });
      if (res.ok) {
        setTxForm({
          ticker_code: "", shares: "", price_per_share: "", currency: "USD",
          transaction_type: "BUY", transaction_date: new Date().toISOString().split("T")[0],
          fees: "0", notes: "", dca_month: "",
        });
        onSubmitted();
      }
    } catch (err) {
      console.error("Failed to add transaction:", err);
    }
  }

  return (
    <div className="card mb-lg">
      <div className="card-title mb-md">Record Transaction</div>
      <form onSubmit={handleAddTransaction} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
        <div>
          <label>Ticker</label>
          <select value={txForm.ticker_code} onChange={(e) => { const m = members.find((x) => x.ticker_code === e.target.value); setTxForm((f) => ({ ...f, ticker_code: e.target.value, currency: m?.currency || "USD" })); }} required style={{ width: "100%" }}>
            <option value="">Select...</option>
            {members.filter((m) => m.is_active).map((m) => (
              <option key={m.ticker_code} value={m.ticker_code}>{m.ticker_code} — {m.short_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Type</label>
          <select value={txForm.transaction_type} onChange={(e) => setTxForm((f) => ({ ...f, transaction_type: e.target.value }))} style={{ width: "100%" }}>
            <option value="BUY">Buy</option>
            <option value="DCA_BUY">DCA Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </div>
        <div><label>Date</label><input type="date" value={txForm.transaction_date} onChange={(e) => setTxForm((f) => ({ ...f, transaction_date: e.target.value }))} style={{ width: "100%" }} /></div>
        <div><label>Shares</label><input type="number" step="0.0001" value={txForm.shares} onChange={(e) => setTxForm((f) => ({ ...f, shares: e.target.value }))} required style={{ width: "100%" }} /></div>
        <div><label>Price/Share</label><input type="number" step="0.0001" value={txForm.price_per_share} onChange={(e) => setTxForm((f) => ({ ...f, price_per_share: e.target.value }))} required style={{ width: "100%" }} /></div>
        <div><label>Fees</label><input type="number" step="0.01" value={txForm.fees} onChange={(e) => setTxForm((f) => ({ ...f, fees: e.target.value }))} style={{ width: "100%" }} /></div>
        <div><label>DCA Month</label><input value={txForm.dca_month} onChange={(e) => setTxForm((f) => ({ ...f, dca_month: e.target.value }))} placeholder="2026-02" style={{ width: "100%" }} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label>Notes</label><input value={txForm.notes} onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))} style={{ width: "100%" }} /></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary">Save</button>
          <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
