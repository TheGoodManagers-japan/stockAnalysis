"use client";

import { useState } from "react";

const INITIAL_FORM = {
  ticker_code: "", entry_price: "", shares: "100",
  initial_stop: "", price_target: "", entry_kind: "DIP", entry_reason: "",
  entry_date: new Date().toISOString().split("T")[0],
};

export default function AddPositionForm({ onSubmit }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const f = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      ...form,
      entry_price: Number(form.entry_price),
      shares: Number(form.shares),
      initial_stop: form.initial_stop ? Number(form.initial_stop) : null,
      price_target: form.price_target ? Number(form.price_target) : null,
      entry_date: form.entry_date,
    });
    setForm({ ...INITIAL_FORM, entry_date: new Date().toISOString().split("T")[0] });
  }

  return (
    <div className="card mb-lg">
      <div className="card-title mb-md">New Position</div>
      <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        <div><label>Ticker</label><input value={form.ticker_code} onChange={f("ticker_code")} placeholder="7203.T" required style={{ width: "100%" }} /></div>
        <div><label>Entry Price</label><input type="number" value={form.entry_price} onChange={f("entry_price")} required style={{ width: "100%" }} /></div>
        <div><label>Entry Date</label><input type="date" value={form.entry_date} onChange={f("entry_date")} required style={{ width: "100%" }} /></div>
        <div><label>Shares</label><input type="number" value={form.shares} onChange={f("shares")} style={{ width: "100%" }} /></div>
        <div><label>Stop Loss</label><input type="number" value={form.initial_stop} onChange={f("initial_stop")} style={{ width: "100%" }} /></div>
        <div><label>Price Target</label><input type="number" value={form.price_target} onChange={f("price_target")} style={{ width: "100%" }} /></div>
        <div><label>Entry Type</label><select value={form.entry_kind} onChange={f("entry_kind")} style={{ width: "100%" }}><option value="DIP">DIP</option><option value="BREAKOUT">BREAKOUT</option><option value="RETEST">RETEST</option><option value="OTHER">OTHER</option></select></div>
        <div style={{ gridColumn: "1 / -1" }}><label>Reason / Notes</label><input value={form.entry_reason} onChange={f("entry_reason")} placeholder="Why are you entering this trade?" style={{ width: "100%" }} /></div>
        <div><button type="submit" className="btn btn-primary">Add Position</button></div>
      </form>
    </div>
  );
}
