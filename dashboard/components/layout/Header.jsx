"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { reportError } from "../../lib/reportError";
import ScanProgress from "./ScanProgress";
import styles from "./Header.module.css";

const MARKETS = [
  { code: "JP", name: "Japan (JPX)" },
  { code: "US", name: "US (S&P 500)" },
  { code: "EU", name: "Europe (Euro Stoxx 50)" },
  { code: "UK", name: "UK (FTSE 100)" },
  { code: "CN", name: "China (Hang Seng)" },
  { code: "IN", name: "India (Nifty 50)" },
  { code: "KR", name: "Korea (KOSPI 50)" },
];

export default function Header({ title }) {
  const [scanning, setScanning] = useState(false);
  const [scanId, setScanId] = useState(null);
  const [market, setMarket] = useState("JP");
  const router = useRouter();

  // On mount, check if there's already a running scan
  useEffect(() => {
    async function checkRunning() {
      try {
        const res = await fetch("/api/scan/progress");
        if (!res.ok) return;
        const data = await res.json();
        if (data.scan?.status === "running") {
          setScanId(data.scan.scan_id);
          setScanning(true);
          if (data.scan.market) setMarket(data.scan.market);
        }
      } catch (err) {
        reportError("component/Header", err, { action: "checkRunningScan" });
      }
    }
    checkRunning();
  }, []);

  const handleComplete = useCallback(
    (scan) => {
      setScanning(false);
      setScanId(null);
    },
    []
  );

  async function handleRunScan() {
    if (scanning) return;
    setScanning(true);
    try {
      const res = await fetch("/api/scan/run-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.scanId) {
          setScanId(data.scanId);
          return;
        }
        reportError("component/Header", `Scan failed: ${res.status}`, { status: res.status });
        setScanning(false);
        return;
      }

      setScanId("pending");
    } catch (err) {
      reportError("component/Header", err, { action: "runScan" });
      setScanning(false);
    }
  }

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title || "Dashboard"}</h1>
      <div className={styles.actions}>
        {scanning && scanId && (
          <ScanProgress scanId={scanId} onComplete={handleComplete} market={market} />
        )}
        <select
          className={styles.marketSelect}
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          disabled={scanning}
        >
          {MARKETS.map((m) => (
            <option key={m.code} value={m.code}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          onClick={handleRunScan}
          disabled={scanning}
        >
          {scanning && <span className="spinner" />}
          {scanning ? "Scanning..." : "Run Scan"}
        </button>
      </div>
    </header>
  );
}
