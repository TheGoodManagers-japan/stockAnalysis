"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { reportError } from "../../lib/reportError";
import ScanProgress from "./ScanProgress";
import styles from "./Header.module.css";

export default function Header({ title }) {
  const [scanning, setScanning] = useState(false);
  const [scanId, setScanId] = useState(null);
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
      // No router.refresh() — useScannerPolling already detects completion
      // and loads final results without a full-page re-render
    },
    []
  );

  async function handleRunScan() {
    if (scanning) return;
    setScanning(true);
    try {
      const res = await fetch("/api/scan/run-script", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.scanId) {
          // Already running — attach to existing scan
          setScanId(data.scanId);
          return;
        }
        reportError("component/Header", `Scan failed: ${res.status}`, { status: res.status });
        setScanning(false);
        return;
      }

      // Script spawned — it will create its own scan_run.
      // Set a placeholder scanId so ScanProgress starts polling
      // /api/scan/progress, which returns the latest scan_run.
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
          <ScanProgress scanId={scanId} onComplete={handleComplete} />
        )}
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
