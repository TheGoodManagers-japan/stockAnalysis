"use client";

import { useState, useEffect, useCallback } from "react";
import MarketThermometer from "../../components/global/MarketThermometer";
import MacroPanel from "../../components/global/MacroPanel";
import AllocationAlerts from "../../components/global/AllocationAlerts";
import CrossMarketOverlay from "../../components/sectors/CrossMarketOverlay";
import SeasonalCalendar from "../../components/global/SeasonalCalendar";
import ScanStatusBanner from "../../components/global/ScanStatusBanner";

export default function GlobalMarketsPage() {
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [crossMarket, setCrossMarket] = useState(null);
  const [seasonal, setSeasonal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [regimeRes, alertsRes, crossRes, calRes] = await Promise.all([
        fetch("/api/global-regime"),
        fetch("/api/global-regime/alerts"),
        fetch("/api/sector-rotation/cross-market"),
        fetch("/api/calendar"),
      ]);
      if (regimeRes.ok) setData(await regimeRes.json());
      if (alertsRes.ok) {
        const alertData = await alertsRes.json();
        setAlerts(alertData.alerts || []);
      }
      if (crossRes.ok) setCrossMarket(await crossRes.json());
      if (calRes.ok) setSeasonal(await calRes.json());
    } catch (err) {
      console.error("Failed to fetch global regime data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/global-regime/run-script", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Global scan launch failed:", body.error || res.status);
        return;
      }
      // Script runs in background (~2 min). Poll until fresh data arrives.
      const before = data?.scanDate || "";
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch("/api/global-regime");
          if (r.ok) {
            const d = await r.json();
            if (d.scanDate && d.scanDate !== before) {
              clearInterval(poll);
              setData(d);
              await fetchData(); // refresh alerts, cross-market, calendar too
              setScanning(false);
            }
          }
        } catch {}
        if (attempts >= 30) { // ~2.5 min timeout
          clearInterval(poll);
          await fetchData();
          setScanning(false);
        }
      }, 5000);
    } catch (err) {
      console.error("Global scan failed:", err);
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2 style={{ color: "var(--text-heading)", marginBottom: "1rem" }}>Global Markets</h2>
        <div className="card"><p className="text-muted">Loading...</p></div>
      </div>
    );
  }

  const snapshots = data?.snapshots || [];
  const macro = data?.macro || null;
  const scanDate = data?.scanDate;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ color: "var(--text-heading)", margin: 0 }}>Global Markets</h2>
          {scanDate && (
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Last scan: {new Date(scanDate).toLocaleDateString()}
            </span>
          )}
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "6px",
            border: "1px solid var(--border-primary)",
            background: scanning ? "var(--bg-tertiary)" : "var(--accent-blue)",
            color: scanning ? "var(--text-muted)" : "#fff",
            cursor: scanning ? "not-allowed" : "pointer",
            fontSize: "0.85rem",
            fontWeight: 500,
          }}
        >
          {scanning ? "Scanning..." : "Run Global Scan"}
        </button>
      </div>

      <ScanStatusBanner scanning={scanning} />

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <AllocationAlerts alerts={alerts} />
        <MarketThermometer snapshots={snapshots} />
        <MacroPanel snapshots={snapshots} macro={macro} />
        <CrossMarketOverlay data={crossMarket} />
        <SeasonalCalendar data={seasonal} />
      </div>
    </>
  );
}
