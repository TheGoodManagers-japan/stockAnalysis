"use client";

import { useState, useEffect, useCallback } from "react";
import ETFSignalTable from "../../components/etf/ETFSignalTable";
import ScanStatusBanner from "../../components/global/ScanStatusBanner";

export default function ETFScannerPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/etf-signals");
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error("Failed to fetch ETF signals:", err);
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
        console.error("ETF scan launch failed:", body.error || res.status);
        return;
      }
      // Script runs regime + ETF signals in background (~2 min). Poll for fresh data.
      const before = data?.signalDate || "";
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch("/api/etf-signals");
          if (r.ok) {
            const d = await r.json();
            if (d.signalDate && d.signalDate !== before) {
              clearInterval(poll);
              setData(d);
              setScanning(false);
            }
          }
        } catch {}
        if (attempts >= 30) {
          clearInterval(poll);
          await fetchData();
          setScanning(false);
        }
      }, 5000);
    } catch (err) {
      console.error("ETF scan failed:", err);
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <>
        <h2 style={{ color: "var(--text-heading)", marginBottom: "1rem" }}>ETF Scanner</h2>
        <div className="card"><p className="text-muted">Loading...</p></div>
      </>
    );
  }

  const signals = data?.signals || [];
  const signalDate = data?.signalDate;
  const buyCount = data?.buyCount || 0;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ color: "var(--text-heading)", margin: 0 }}>ETF Scanner</h2>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {signalDate ? `Last scan: ${new Date(signalDate).toLocaleDateString()}` : "No scans yet"}
            {buyCount > 0 && ` \u2022 ${buyCount} buy signal${buyCount > 1 ? "s" : ""}`}
          </span>
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
          {scanning ? "Scanning..." : "Run ETF Scan"}
        </button>
      </div>

      <ScanStatusBanner scanning={scanning} />
      <ETFSignalTable signals={signals} />
    </>
  );
}
