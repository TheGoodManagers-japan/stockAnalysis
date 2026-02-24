"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import ValuePlayCard from "./ValuePlayCard";
import cardStyles from "./ValuePlayCard.module.css";
import styles from "./ValuePlaysTable.module.css";
import {
  formatNum,
  formatSector,
  gradeColor,
  gradeBg,
  classificationLabel,
  classificationColor,
  classificationBg,
  valuationColor,
  pillarColor,
} from "../../lib/uiHelpers";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useAddToPortfolio } from "../../hooks/useAddToPortfolio";
import AddToPortfolioPopup from "../scanner/AddToPortfolioPopup";

const CLASSIFICATIONS = [
  { key: "All", label: "All Types", desc: "" },
  { key: "DEEP_VALUE", label: "Deep Value", desc: "Trading well below intrinsic value (low PE, PB)" },
  { key: "QARP", label: "QARP", desc: "Quality business at a reasonable price" },
  { key: "DIVIDEND_COMPOUNDER", label: "Dividend Compounder", desc: "Growing dividends backed by strong cash flow" },
  { key: "ASSET_PLAY", label: "Asset Play", desc: "Hidden value in balance sheet (net cash, low P/TBV)" },
  { key: "RECOVERY_VALUE", label: "Recovery Value", desc: "Turnaround with improving earnings momentum" },
];

const GRADES = ["All", "A", "B", "C"];

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

const VALUE_COLUMNS = [
  { key: "ticker_code", label: "Ticker", sortable: true },
  { key: "sector", label: "Sector", sortable: true },
  { key: "current_price", label: "Price", sortable: true, mono: true },
  { key: "value_play_score", label: "Score", sortable: true, mono: true },
  { key: "value_play_grade", label: "Grade", sortable: true },
  { key: "value_play_class", label: "Type", sortable: true },
  { key: "fundamental_score", label: "Quality", sortable: true, mono: true },
  { key: "valuation_score", label: "Value", sortable: true, mono: true },
  { key: "tier", label: "Tier", sortable: true },
  { key: "market_regime", label: "Regime", sortable: true },
];

function fmt(v, suffix = "") {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  return `${Number(v).toFixed(1)}${suffix}`;
}

export default function ValuePlaysTable({ results = [] }) {
  const [viewMode, setViewMode] = useLocalStorage("value-plays-view-mode", "card");
  const [sortKey, setSortKey] = useState("value_play_score");
  const [sortDir, setSortDir] = useState("desc");
  const [classFilter, setClassFilter] = useState("All");
  const [gradeFilter, setGradeFilter] = useState("All");
  const [sectorFilter, setSectorFilter] = useState("All");
  const [search, setSearch] = useState("");

  const {
    addingTicker,
    addForm,
    setAddForm,
    addStatus,
    addedTickers,
    popupRef,
    openAddPopup,
    handleAddSubmit,
    handleAddCancel,
  } = useAddToPortfolio();

  const filtered = useMemo(() => {
    let data = [...results];

    if (classFilter !== "All") {
      data = data.filter((r) => r.value_play_class === classFilter);
    }
    if (gradeFilter !== "All") {
      data = data.filter((r) => r.value_play_grade === gradeFilter);
    }
    if (sectorFilter !== "All") {
      data = data.filter((r) => r.sector === sectorFilter);
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
      let va = a[sortKey];
      let vb = b[sortKey];
      if (va == null) va = sortDir === "asc" ? Infinity : -Infinity;
      if (vb == null) vb = sortDir === "asc" ? Infinity : -Infinity;
      if (typeof va === "string") { va = va.toLowerCase(); vb = (vb || "").toLowerCase(); }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  }, [results, classFilter, gradeFilter, sectorFilter, search, sortKey, sortDir]);

  const [classOpen, setClassOpen] = useState(false);
  const classRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (classRef.current && !classRef.current.contains(e.target)) {
        setClassOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const activeClass = CLASSIFICATIONS.find((c) => c.key === classFilter);

  return (
    <div>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search ticker..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className={styles.classDropdown} ref={classRef}>
            <button
              className={styles.filterSelect}
              onClick={() => setClassOpen((o) => !o)}
              type="button"
            >
              {activeClass?.label || "All Types"}
              <span className={styles.dropdownArrow}>{classOpen ? "\u25B2" : "\u25BC"}</span>
            </button>
            {classOpen && (
              <div className={styles.classMenu}>
                {CLASSIFICATIONS.map((c) => (
                  <button
                    key={c.key}
                    className={`${styles.classOption} ${classFilter === c.key ? styles.classOptionActive : ""}`}
                    onClick={() => { setClassFilter(c.key); setClassOpen(false); }}
                    type="button"
                  >
                    <span className={styles.classOptionLabel}>{c.label}</span>
                    {c.desc && <span className={styles.classOptionDesc}>{c.desc}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <select
            className={styles.filterSelect}
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
          >
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g === "All" ? "All Grades" : `Grade ${g}`}
              </option>
            ))}
          </select>
          <select
            className={styles.filterSelect}
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
          >
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {s === "All" ? "All Sectors" : formatSector(s)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.viewToggle}>
          <span className={styles.resultCount}>{filtered.length} results</span>
          <button
            className={`${styles.viewBtn} ${viewMode === "card" ? styles.viewBtnActive : ""}`}
            onClick={() => setViewMode("card")}
            title="Card view"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            className={`${styles.viewBtn} ${viewMode === "table" ? styles.viewBtnActive : ""}`}
            onClick={() => setViewMode("table")}
            title="Table view"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className={styles.empty}>
          No value plays found. Run a scan to populate value play candidates.
        </div>
      ) : viewMode === "card" ? (
        <div className={cardStyles.cardGrid}>
          {filtered.map((stock) => (
            <ValuePlayCard
              key={stock.ticker_code}
              stock={stock}
              isAdded={addedTickers.has(stock.ticker_code)}
              onAddClick={openAddPopup}
            />
          ))}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {VALUE_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={col.sortable ? styles.sortable : ""}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span className={styles.sortArrow}>
                        {sortDir === "asc" ? " \u25B2" : " \u25BC"}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.ticker_code} className={styles.tableRow}>
                  <td>
                    <Link href={`/scanner/${row.ticker_code}`} className={styles.tickerLink}>
                      {row.ticker_code}
                    </Link>
                    {row.short_name && (
                      <div className={styles.shortName}>{row.short_name}</div>
                    )}
                  </td>
                  <td>{formatSector(row.sector)}</td>
                  <td className={styles.mono}>{formatNum(row.current_price)}</td>
                  <td className={styles.mono} style={{ color: gradeColor(row.value_play_grade) }}>
                    {row.value_play_score}
                  </td>
                  <td>
                    <span
                      style={{
                        background: gradeBg(row.value_play_grade),
                        color: gradeColor(row.value_play_grade),
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                      }}
                    >
                      {row.value_play_grade}
                    </span>
                  </td>
                  <td>
                    {row.value_play_class && (
                      <span
                        style={{
                          background: classificationBg(row.value_play_class),
                          color: classificationColor(row.value_play_class),
                          padding: "2px 8px",
                          borderRadius: "9999px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          border: `1px solid ${classificationColor(row.value_play_class)}`,
                        }}
                      >
                        {classificationLabel(row.value_play_class)}
                      </span>
                    )}
                  </td>
                  <td className={styles.mono}>{fmt(row.fundamental_score)}</td>
                  <td className={styles.mono}>{fmt(row.valuation_score)}</td>
                  <td>
                    <span className={`badge badge-tier-${row.tier || 3}`}>
                      T{row.tier || "?"}
                    </span>
                  </td>
                  <td>
                    {row.market_regime && (
                      <span className={`badge ${
                        row.market_regime === "STRONG_UP" || row.market_regime === "UP"
                          ? "badge-buy"
                          : row.market_regime === "DOWN" ? "badge-sell" : "badge-neutral"
                      }`}>
                        {row.market_regime}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add-to-portfolio popup */}
      {addingTicker && (
        <AddToPortfolioPopup
          tickerCode={addingTicker}
          form={addForm}
          setForm={setAddForm}
          status={addStatus}
          onSubmit={handleAddSubmit}
          onClose={handleAddCancel}
          popupRef={popupRef}
          styles={styles}
        />
      )}
    </div>
  );
}
