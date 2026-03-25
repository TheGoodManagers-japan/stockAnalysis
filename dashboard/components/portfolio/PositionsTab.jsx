"use client";

import Link from "next/link";
import NewsContextBadge from "../ui/NewsContextBadge";
import { formatNum } from "../../lib/uiHelpers";

export default function PositionsTab({ holdings, closedTrades, newsAlerts = {}, loading, onUpdateStop, onClosePosition, onEditPosition, onDeletePosition }) {
  return (
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
                  <th>News</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const news = newsAlerts[h.ticker_code];
                  return (
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
                      <td>
                        <NewsContextBadge
                          articleCount={news?.article_count}
                          avgSentiment={news?.avg_sentiment}
                          maxImpact={news?.max_impact}
                          latestHeadline={news?.latest_headline}
                          compact
                        />
                      </td>
                      <td style={{ display: "flex", gap: 4 }}>
                        <button className="btn btn-sm" onClick={() => onEditPosition(h)}>Edit</button>
                        <button className="btn btn-sm" onClick={() => { const s = prompt("New stop price?"); if (s) onUpdateStop(h.id, s); }}>Stop</button>
                        <button className="btn btn-sm btn-danger" onClick={() => { const p = prompt("Exit price?"); const r = prompt("Exit reason?"); if (p) onClosePosition(h.id, Number(p), r || "Manual"); }}>Close</button>
                        <button className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Delete ${h.ticker_code} position? This cannot be undone.`)) onDeletePosition(h.id); }}>Del</button>
                      </td>
                    </tr>
                  );
                })}
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
                <tr><th>Ticker</th><th>Entry</th><th>Exit</th><th>P&L</th><th>P&L %</th><th>Reason</th><th>Closed</th><th>Actions</th></tr>
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
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Delete closed trade ${t.ticker_code}? This cannot be undone.`)) onDeletePosition(t.id); }}>Del</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
