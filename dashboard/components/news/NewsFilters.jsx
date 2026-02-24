"use client";

export default function NewsFilters({ filters, onFilterChange, onClear }) {
  return (
    <div className="card mb-lg" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div>
        <label>Source</label>
        <select value={filters.source} onChange={e => onFilterChange("source", e.target.value)}>
          <option value="">All</option>
          <option value="kabutan">Kabutan</option>
          <option value="jquants">J-Quants</option>
          <option value="yahoo_rss">Yahoo JP</option>
          <option value="nikkei">Nikkei</option>
          <option value="minkabu">Minkabu</option>
          <option value="reuters">Reuters</option>
        </select>
      </div>
      <div>
        <label>Sentiment</label>
        <select value={filters.sentiment} onChange={e => onFilterChange("sentiment", e.target.value)}>
          <option value="">All</option>
          <option value="Bullish">Bullish</option>
          <option value="Bearish">Bearish</option>
          <option value="Neutral">Neutral</option>
        </select>
      </div>
      <div>
        <label>Impact</label>
        <select value={filters.impact} onChange={e => onFilterChange("impact", e.target.value)}>
          <option value="">All</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div>
        <label>Ticker</label>
        <input
          type="text"
          placeholder="e.g. 7203"
          value={filters.ticker}
          onChange={e => onFilterChange("ticker", e.target.value)}
          style={{ width: 100 }}
        />
      </div>
      <button className="btn btn-secondary btn-sm" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
