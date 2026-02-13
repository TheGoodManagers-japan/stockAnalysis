"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
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
      } catch {}
    }
    checkRunning();
  }, []);

  const handleComplete = useCallback(
    (scan) => {
      setScanning(false);
      setScanId(null);
      router.refresh();
    },
    [router]
  );

  async function handleRunScan() {
    if (scanning) return;
    setScanning(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.scanId) {
          // Already running — attach to existing scan
          setScanId(data.scanId);
          return;
        }
        console.error("Scan failed:", res.status);
        setScanning(false);
        return;
      }

      const data = await res.json();
      setScanId(data.scanId);
    } catch (err) {
      console.error("Scan error:", err);
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
