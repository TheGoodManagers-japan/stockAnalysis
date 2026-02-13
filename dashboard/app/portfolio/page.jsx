"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

function formatNum(v) {
  if (v == null) return "-";
  return Number(v).toLocaleString();
}

const TABS = ["Positions", "Analytics", "Risk", "Journal"];
const PIE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#f97316", "#06b6d4", "#ec4899"];

export default function PortfolioPage() {
  const [activeTab, setActiveTab] = useState("Positions");
  const [holdings, setHoldings] = useState([]);
  const [closedTrades, setClosedTrades] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [journal, setJournal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    ticker_code: "", entry_price: "", shares: "100",
    initial_stop: "", price_target: "", entry_kind: "DIP", entry_reason: "",
    entry_date: new Date().toISOString().split("T")[0],
  });
  const [journalForm, setJournalForm] = useState({ holding_id: "", content: "", note_type: "note", tags: "" });
  const [sizingCalc, setSizingCalc] = useState({ accountSize: "", riskPct: "1", stopDistance: "" });

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      const data = await res.json();
      if (data.success) {
        setHoldings(data.open || []);
        setClosedTrades(data.closed || []);
      }
    } catch (err) {
      console.error("Failed to fetch portfolio:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio/analytics");
      const data = await res.json();
      if (data.success) setAnalytics(data);
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
    }
  }, []);

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio/snapshots");
      const data = await res.json();
      if (data.success) setSnapshots(data.snapshots || []);
    } catch (err) {
      console.error("Failed to fetch snapshots:", err);
    }
  }, []);

  const fetchJournal = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio/journal");
      const data = await res.json();
      if (data.success) setJournal(data.entries || []);
    } catch (err) {
      console.error("Failed to fetch journal:", err);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
    fetchAnalytics();
    fetchSnapshots();
    fetchJournal();
  }, [fetchPortfolio, fetchAnalytics, fetchSnapshots, fetchJournal]);

  async function handleAdd(e) {
    e.preventDefault();
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          entry_price: Number(form.entry_price),
          shares: Number(form.shares),
          initial_stop: form.initial_stop ? Number(form.initial_stop) : null,
          price_target: form.price_target ? Number(form.price_target) : null,
          entry_date: form.entry_date,
        }),
      });
      if (res.ok) {
        setShowAddForm(false);
        setForm({ ticker_code: "", entry_price: "", shares: "100", initial_stop: "", price_target: "", entry_kind: "DIP", entry_reason: "", entry_date: new Date().toISOString().split("T")[0] });
        fetchPortfolio();
        fetchAnalytics();
      }
    } catch (err) {
      console.error("Failed to add position:", err);
    }
  }

  async function handleClose(id, exitPrice, exitReason) {
    try {
      await fetch("/api/portfolio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id, status: "closed", exit_price: exitPrice,
          exit_reason: exitReason, closed_at: new Date().toISOString().split("T")[0],
        }),
      });
      fetchPortfolio();
      fetchAnalytics();
    } catch (err) {
      console.error("Failed to close position:", err);
    }
  }

  async function handleUpdateStop(id, newStop) {
    try {
      await fetch("/api/portfolio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, current_stop: Number(newStop) }),
      });
      fetchPortfolio();
    } catch (err) {
      console.error("Failed to update stop:", err);
    }
  }

  async function handleAddJournal(e) {
    e.preventDefault();
    try {
      await fetch("/api/portfolio/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holding_id: Number(journalForm.holding_id),
          content: journalForm.content,
          note_type: journalForm.note_type,
          tags: journalForm.tags ? journalForm.tags.split(",").map((t) => t.trim()) : [],
        }),
      });
      setJournalForm({ holding_id: "", content: "", note_type: "note", tags: "" });
      fetchJournal();
    } catch (err) {
      console.error("Failed to add journal entry:", err);
    }
  }

  const suggestedShares = useMemo(() => {
    const acct = Number(sizingCalc.accountSize);
    const risk = Number(sizingCalc.riskPct) / 100;
    const stop = Number(sizingCalc.stopDistance);
    if (acct > 0 && risk > 0 && stop > 0) {
      return Math.floor((acct * risk) / stop);
    }
    return 0;
  }, [sizingCalc]);

  return (
    <>
      <div className="flex-between mb-lg">
        <h2 style={{ color: "var(--text-heading)" }}>Portfolio</h2>
        <button className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Position"}
        </button>
      </div>

      {/* Add Position Form */}
      {showAddForm && (
        <div className="card mb-lg">
          <div className="card-title mb-md">New Position</div>
          <form onSubmit={handleAdd} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
            <div><label>Ticker</label><input value={form.ticker_code} onChange={(e) => setForm((f) => ({ ...f, ticker_code: e.target.value }))} placeholder="7203.T" required style={{ width: "100%" }} /></div>
            <div><label>Entry Price</label><input type="number" value={form.entry_price} onChange={(e) => setForm((f) => ({ ...f, entry_price: e.target.value }))} required style={{ width: "100%" }} /></div>
            <div><label>Entry Date</label><input type="date" value={form.entry_date} onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))} required style={{ width: "100%" }} /></div>
            <div><label>Shares</label><input type="number" value={form.shares} onChange={(e) => setForm((f) => ({ ...f, shares: e.target.value }))} style={{ width: "100%" }} /></div>
            <div><label>Stop Loss</label><input type="number" value={form.initial_stop} onChange={(e) => setForm((f) => ({ ...f, initial_stop: e.target.value }))} style={{ width: "100%" }} /></div>
            <div><label>Price Target</label><input type="number" value={form.price_target} onChange={(e) => setForm((f) => ({ ...f, price_target: e.target.value }))} style={{ width: "100%" }} /></div>
            <div><label>Entry Type</label><select value={form.entry_kind} onChange={(e) => setForm((f) => ({ ...f, entry_kind: e.target.value }))} style={{ width: "100%" }}><option value="DIP">DIP</option><option value="BREAKOUT">BREAKOUT</option><option value="RETEST">RETEST</option><option value="OTHER">OTHER</option></select></div>
            <div style={{ gridColumn: "1 / -1" }}><label>Reason / Notes</label><input value={form.entry_reason} onChange={(e) => setForm((f) => ({ ...f, entry_reason: e.target.value }))} placeholder="Why are you entering this trade?" style={{ width: "100%" }} /></div>
            <div><button type="submit" className="btn btn-primary">Add Position</button></div>
          </form>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border-primary)", marginBottom: 16 }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 20px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid var(--accent-blue)" : "2px solid transparent",
              color: activeTab === tab ? "var(--accent-blue)" : "var(--text-muted)",
              cursor: "pointer",
              fontWeight: activeTab === tab ? 600 : 400,
              fontSize: "0.9rem",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab: Positions */}
      {activeTab === "Positions" && (
        <>
          <div className="card mb-lg">
            <div className="card-title mb-md">Open Positions ({holdings.length})</div>
            {loading ? (
              <div style={{ padding: 20, textAlign: "center" }}><span className="spinner" /></div>
            ) : holdings.length === 0 ? (
              <p className="text-muted">No open positions.</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Entry</th>
                      <th>Shares</th>
                      <th>Stop</th>
                      <th>Target</th>
                      <th>Type</th>
                      <th>Date</th>
                      <th>Signal</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h) => (
                      <tr key={h.id}>
                        <td style={{ fontWeight: 600 }}>
                          <Link href={`/scanner/${h.ticker_code}`} style={{ color: "var(--accent-blue)", textDecoration: "none" }}>
                            {h.ticker_code}
                          </Link>
                        </td>
                        <td className="text-mono">{formatNum(h.entry_price)}</td>
                        <td>{h.shares}</td>
                        <td className="text-mono text-red">{formatNum(h.current_stop || h.initial_stop)}</td>
                        <td className="text-mono text-green">{formatNum(h.price_target)}</td>
                        <td><span className="badge badge-neutral">{h.entry_kind || "-"}</span></td>
                        <td className="text-muted">{h.entry_date || "-"}</td>
                        <td>
                          {h.mgmt_signal_status ? (
                            <span className={`badge ${h.mgmt_signal_status === "Hold" ? "badge-hold" : h.mgmt_signal_status === "Sell Now" ? "badge-sell" : "badge-buy"}`}>
                              {h.mgmt_signal_status}
                            </span>
                          ) : "-"}
                        </td>
                        <td style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => { const s = prompt("New stop price?"); if (s) handleUpdateStop(h.id, s); }}>Stop</button>
                          <button className="btn btn-sm btn-danger" onClick={() => { const p = prompt("Exit price?"); const r = prompt("Exit reason?"); if (p) handleClose(h.id, Number(p), r || "Manual"); }}>Close</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {closedTrades.length > 0 && (
            <div className="card">
              <div className="card-title mb-md">Closed Trades ({closedTrades.length})</div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr><th>Ticker</th><th>Entry</th><th>Exit</th><th>P&L</th><th>P&L %</th><th>Reason</th><th>Closed</th></tr>
                  </thead>
                  <tbody>
                    {closedTrades.map((t) => {
                      const pnlPct = t.pnl_pct ? Number(t.pnl_pct) : null;
                      return (
                        <tr key={t.id}>
                          <td style={{ fontWeight: 600 }}>{t.ticker_code}</td>
                          <td className="text-mono">{formatNum(t.entry_price)}</td>
                          <td className="text-mono">{formatNum(t.exit_price)}</td>
                          <td className="text-mono" style={{ color: Number(t.pnl_amount) >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>{formatNum(t.pnl_amount)}</td>
                          <td className="text-mono" style={{ color: pnlPct != null && pnlPct >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>{pnlPct != null ? `${pnlPct.toFixed(2)}%` : "-"}</td>
                          <td>{t.exit_reason || "-"}</td>
                          <td className="text-muted">{t.closed_at || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tab: Analytics */}
      {activeTab === "Analytics" && analytics && (
        <>
          {/* Key Metrics */}
          <div className="grid-4 mb-lg">
            {[
              ["Win Rate", `${analytics.performance.winRate}%`, analytics.performance.winRate >= 50 ? "var(--accent-green)" : "var(--accent-red)"],
              ["Avg R-Multiple", analytics.performance.avgRMultiple, analytics.performance.avgRMultiple >= 0 ? "var(--accent-green)" : "var(--accent-red)"],
              ["Expectancy", `${analytics.performance.expectancy}%`, analytics.performance.expectancy >= 0 ? "var(--accent-green)" : "var(--accent-red)"],
              ["Max Drawdown", `${analytics.performance.maxDrawdownPct}%`, "var(--accent-red)"],
            ].map(([label, val, color]) => (
              <div className="card" key={label}>
                <div className="card-subtitle">{label}</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 700, color }}>{val}</div>
              </div>
            ))}
          </div>

          <div className="grid-2 mb-lg">
            {[
              ["Total Trades", analytics.performance.totalTrades],
              ["Wins / Losses", `${analytics.performance.winCount} / ${analytics.performance.lossCount}`],
              ["Profit Factor", analytics.performance.profitFactor],
              ["Net P&L", formatNum(analytics.performance.netPnl)],
              ["Avg Win", `${analytics.performance.avgWinPct}%`],
              ["Avg Loss", `${analytics.performance.avgLossPct}%`],
            ].map(([label, val]) => (
              <div key={label} className="flex-between" style={{ padding: "6px 0", borderBottom: "1px solid var(--border-primary)" }}>
                <span className="text-secondary">{label}</span>
                <span className="text-mono" style={{ fontWeight: 600 }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Equity Curve */}
          {analytics.equityCurve.length > 0 && (
            <div className="card mb-lg">
              <div className="card-title mb-md">Equity Curve (Cumulative P&L)</div>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={analytics.equityCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#151d2e", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
                  <Area type="monotone" dataKey="pnl" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly P&L */}
          {analytics.monthlyPnl.length > 0 && (
            <div className="card mb-lg">
              <div className="card-title mb-md">Monthly P&L</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={analytics.monthlyPnl}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#151d2e", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
                  <Bar dataKey="pnl" fill="#3b82f6">
                    {analytics.monthlyPnl.map((entry, i) => (
                      <Cell key={i} fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {/* Tab: Risk */}
      {activeTab === "Risk" && analytics && (
        <>
          <div className="grid-2 mb-lg">
            {/* Sector Exposure */}
            <div className="card">
              <div className="card-title mb-md">Sector Exposure</div>
              {analytics.risk.sectorExposure.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={analytics.risk.sectorExposure}
                      dataKey="value"
                      nameKey="sector"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ sector, pct }) => `${sector.substring(0, 12)} ${pct}%`}
                    >
                      {analytics.risk.sectorExposure.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#151d2e", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted">No open positions.</p>
              )}
            </div>

            {/* Risk Metrics */}
            <div className="card">
              <div className="card-title mb-md">Risk Metrics</div>
              <div style={{ display: "grid", gap: 12 }}>
                <div className="flex-between">
                  <span className="text-secondary">Total Exposure</span>
                  <span className="text-mono" style={{ fontWeight: 600 }}>{formatNum(analytics.risk.totalExposure)}</span>
                </div>
                <div className="flex-between">
                  <span className="text-secondary">Open Positions</span>
                  <span style={{ fontWeight: 600 }}>{analytics.risk.openPositions}</span>
                </div>
                <div className="flex-between">
                  <span className="text-secondary">Largest Position</span>
                  <span className="text-mono">{analytics.risk.largestPositionPct}%</span>
                </div>
                {analytics.risk.top3.map((p) => (
                  <div key={p.ticker} className="flex-between">
                    <span className="text-muted">{p.ticker}</span>
                    <span className="text-mono">{p.pct}%</span>
                  </div>
                ))}
                <hr style={{ border: "none", borderTop: "1px solid var(--border-primary)" }} />
                <div className="flex-between">
                  <span className="text-secondary">Portfolio Heat</span>
                  <span className="text-mono text-red" style={{ fontWeight: 600 }}>
                    {formatNum(analytics.risk.portfolioHeat)}
                  </span>
                </div>
                <div className="text-muted" style={{ fontSize: "0.72rem" }}>
                  Total loss if all stops are hit simultaneously.
                </div>
              </div>
            </div>
          </div>

          {/* Position Sizing Calculator */}
          <div className="card">
            <div className="card-title mb-md">Position Sizing Calculator</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, alignItems: "end" }}>
              <div>
                <label>Account Size (JPY)</label>
                <input type="number" value={sizingCalc.accountSize} onChange={(e) => setSizingCalc((s) => ({ ...s, accountSize: e.target.value }))} placeholder="1,000,000" style={{ width: "100%" }} />
              </div>
              <div>
                <label>Risk per Trade (%)</label>
                <input type="number" value={sizingCalc.riskPct} onChange={(e) => setSizingCalc((s) => ({ ...s, riskPct: e.target.value }))} step="0.1" style={{ width: "100%" }} />
              </div>
              <div>
                <label>Stop Distance (JPY per share)</label>
                <input type="number" value={sizingCalc.stopDistance} onChange={(e) => setSizingCalc((s) => ({ ...s, stopDistance: e.target.value }))} placeholder="50" style={{ width: "100%" }} />
              </div>
              <div>
                <div className="card-subtitle">Suggested Shares</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--accent-blue)" }}>
                  {suggestedShares > 0 ? suggestedShares : "-"}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Tab: Journal */}
      {activeTab === "Journal" && (
        <>
          <div className="card mb-lg">
            <div className="card-title mb-md">Add Journal Entry</div>
            <form onSubmit={handleAddJournal} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
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
      )}
    </>
  );
}
