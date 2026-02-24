"use client";

import dynamic from "next/dynamic";

export const PriceChart = dynamic(
  () => import("../../../components/stock/PriceChart"),
  {
    ssr: false,
    loading: () => (
      <div className="card" style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="spinner" />
      </div>
    ),
  }
);

export const ScanHistoryChart = dynamic(
  () => import("../../../components/stock/ScanHistoryChart"),
  {
    ssr: false,
    loading: () => (
      <div className="card" style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="spinner" />
      </div>
    ),
  }
);
