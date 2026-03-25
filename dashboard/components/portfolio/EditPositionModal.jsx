"use client";

import { useState, useEffect } from "react";
import Modal from "../ui/Modal";

export default function EditPositionModal({ isOpen, onClose, holding, onSave }) {
  const [form, setForm] = useState({});

  useEffect(() => {
    if (holding && isOpen) {
      setForm({
        ticker_code: holding.ticker_code || "",
        entry_price: holding.entry_price ?? "",
        entry_date: holding.entry_date
          ? new Date(holding.entry_date).toISOString().split("T")[0]
          : "",
        shares: holding.shares ?? "100",
        initial_stop: holding.initial_stop ?? "",
        current_stop: holding.current_stop ?? "",
        price_target: holding.price_target ?? "",
        entry_kind: holding.entry_kind || "DIP",
        entry_reason: holding.entry_reason || "",
      });
    }
  }, [holding, isOpen]);

  const f = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    onSave(holding.id, {
      ticker_code: form.ticker_code,
      entry_price: Number(form.entry_price),
      entry_date: form.entry_date,
      shares: Number(form.shares),
      initial_stop: form.initial_stop ? Number(form.initial_stop) : null,
      current_stop: form.current_stop ? Number(form.current_stop) : null,
      price_target: form.price_target ? Number(form.price_target) : null,
      entry_kind: form.entry_kind,
      entry_reason: form.entry_reason,
    });
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Edit Position — ${holding?.ticker_code || ""}`} maxWidth={700}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, padding: "12px 0" }}>
        <div><label>Ticker</label><input value={form.ticker_code || ""} onChange={f("ticker_code")} required style={{ width: "100%" }} /></div>
        <div><label>Entry Price</label><input type="number" step="any" value={form.entry_price ?? ""} onChange={f("entry_price")} required style={{ width: "100%" }} /></div>
        <div><label>Entry Date</label><input type="date" value={form.entry_date || ""} onChange={f("entry_date")} required style={{ width: "100%" }} /></div>
        <div><label>Shares</label><input type="number" value={form.shares ?? ""} onChange={f("shares")} style={{ width: "100%" }} /></div>
        <div><label>Initial Stop</label><input type="number" step="any" value={form.initial_stop ?? ""} onChange={f("initial_stop")} style={{ width: "100%" }} /></div>
        <div><label>Current Stop</label><input type="number" step="any" value={form.current_stop ?? ""} onChange={f("current_stop")} style={{ width: "100%" }} /></div>
        <div><label>Price Target</label><input type="number" step="any" value={form.price_target ?? ""} onChange={f("price_target")} style={{ width: "100%" }} /></div>
        <div>
          <label>Entry Type</label>
          <select value={form.entry_kind || "DIP"} onChange={f("entry_kind")} style={{ width: "100%" }}>
            <option value="DIP">DIP</option>
            <option value="BREAKOUT">BREAKOUT</option>
            <option value="RETEST">RETEST</option>
            <option value="OTHER">OTHER</option>
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}><label>Reason / Notes</label><input value={form.entry_reason || ""} onChange={f("entry_reason")} style={{ width: "100%" }} /></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary">Save</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
