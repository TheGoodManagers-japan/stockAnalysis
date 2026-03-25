"use client";

import { useMemo } from "react";
import { useSessionStorage } from "./useSessionStorage";

const SECTORS = [
  "All",
  "automobiles_transportation_equipment",
  "banking",
  "commercial_wholesale_trade",
  "construction_materials",
  "electric_appliances_precision",
  "electric_power_gas",
  "financials_ex_banks",
  "foods",
  "it_services_others",
  "machinery",
  "pharmaceutical",
  "raw_materials_chemicals",
  "real_estate",
  "retail_trade",
  "steel_nonferrous_metals",
  "transportation_logistics",
];

/**
 * Sorting, filtering, and search logic for the scanner results list.
 * Filter state is persisted to sessionStorage so it survives navigation.
 * @param {Array} results - The active results array to sort/filter.
 * @returns Filtered/sorted data plus all filter state setters.
 */
export function useScannerSort(results) {
  const [sortKey, setSortKey] = useSessionStorage("scanner-sortKey", "master_score");
  const [sortDir, setSortDir] = useSessionStorage("scanner-sortDir", "desc");
  const [sectorFilter, setSectorFilter] = useSessionStorage("scanner-sector", "All");
  const [buyOnly, setBuyOnly] = useSessionStorage("scanner-buyOnly", false);
  const [liquidOnly, setLiquidOnly] = useSessionStorage("scanner-liquidOnly", false);
  const [search, setSearch] = useSessionStorage("scanner-search", "");

  const filtered = useMemo(() => {
    let data = [...results];

    if (sectorFilter !== "All") {
      data = data.filter((r) => r.sector === sectorFilter);
    }
    if (buyOnly) {
      data = data.filter((r) => r.is_buy_now);
    }
    if (liquidOnly) {
      data = data.filter((r) => r.liq_pass);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      data = data.filter(
        (r) =>
          r.ticker_code?.toLowerCase().includes(q) ||
          r.short_name?.toLowerCase().includes(q)
      );
    }

    data.sort((a, b) => {
      let va = sortKey === "ml_confidence" ? a.ml_signal_confidence : a[sortKey];
      let vb = sortKey === "ml_confidence" ? b.ml_signal_confidence : b[sortKey];
      if (va == null) va = sortDir === "asc" ? Infinity : -Infinity;
      if (vb == null) vb = sortDir === "asc" ? Infinity : -Infinity;
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (typeof va === "boolean") { va = va ? 0 : 1; vb = vb ? 0 : 1; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  }, [results, sortKey, sortDir, sectorFilter, buyOnly, liquidOnly, search]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return {
    filtered,
    sortKey,
    sortDir,
    handleSort,
    sectorFilter,
    setSectorFilter,
    buyOnly,
    setBuyOnly,
    liquidOnly,
    setLiquidOnly,
    search,
    setSearch,
    SECTORS,
  };
}
