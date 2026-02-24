"use client";

import { useState } from "react";

export default function JournalTab({ holdings, closedTrades, journal, onAddEntry }) {
  const [journalForm, setJournalForm] = useState({ holding_id: "", content: "", note_type: "note", tags: "" });

  function handleSubmit(e) {
    e.preventDefault();
    onAddEntry({
      holding_id: Number(journalForm.holding_id),
      content: journalForm.content,
      note_type: journalForm.note_type,
      tags: journalForm.tags ? journalForm.tags.split(",").map((t) => t.trim()) : [],
    });
    setJournalForm({ holding_id: "", content: "", note_type: "note", tags: "" });
  }

  return (
    <>
      <div className="card mb-lg">
        <div className="card-title mb-md">Add Journal Entry</div>
        <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          <div>
            <label>Position</label>
            <select value={journalForm.holding_id} onChange={(e) => setJournalForm((f) => ({ ...f, holding_id: e.target.value }))} required style={{ width: "100%" }}>
              <option value="">Select...</option>
              {[...holdings, ...closedTrades].map((h) => (
                <option key={h.id} value={h.id}>{h.ticker_code} ({h.status === "open" ? "Open" : "Closed"})</option>
              ))}
            </select>
          </div>
          <div>
            <label>Type</label>
            <select value={journalForm.note_type} onChange={(e) => setJournalForm((f) => ({ ...f, note_type: e.target.value }))} style={{ width: "100%" }}>
              <option value="note">Note</option>
              <option value="lesson">Lesson</option>
              <option value="mistake">Mistake</option>
              <option value="thesis">Thesis</option>
            </select>
          </div>
          <div>
            <label>Tags (comma-separated)</label>
            <input value={journalForm.tags} onChange={(e) => setJournalForm((f) => ({ ...f, tags: e.target.value }))} placeholder="risk, timing" style={{ width: "100%" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label>Content</label>
            <textarea value={journalForm.content} onChange={(e) => setJournalForm((f) => ({ ...f, content: e.target.value }))} required rows={3} style={{ width: "100%", resize: "vertical" }} />
          </div>
          <div><button type="submit" className="btn btn-primary">Add Entry</button></div>
        </form>
      </div>

      <div className="card">
        <div className="card-title mb-md">Journal Entries ({journal.length})</div>
        {journal.length === 0 ? (
          <p className="text-muted">No journal entries yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {journal.map((entry) => (
              <div key={entry.id} style={{ padding: 12, background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", borderLeft: `3px solid ${entry.note_type === "lesson" ? "var(--accent-green)" : entry.note_type === "mistake" ? "var(--accent-red)" : entry.note_type === "thesis" ? "var(--accent-purple)" : "var(--accent-blue)"}` }}>
                <div className="flex-between mb-sm">
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontWeight: 600 }}>{entry.ticker_code}</span>
                    <span className="badge badge-neutral" style={{ fontSize: "0.7rem" }}>{entry.note_type}</span>
                    {entry.tags?.map((tag) => (
                      <span key={tag} style={{ fontSize: "0.7rem", color: "var(--accent-blue)" }}>#{tag}</span>
                    ))}
                  </div>
                  <span className="text-muted" style={{ fontSize: "0.72rem" }}>
                    {entry.entry_date ? new Date(entry.entry_date).toLocaleDateString("ja-JP") : ""}
                  </span>
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{entry.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
