// US sector pools — SPDR sector ETFs as single-ticker proxies for each GICS sector.
// Used by sectorRotationMonitor.js with pools=sectorPoolsUS, benchmarkTicker="SPY".

export const sectorPoolsUS = {
  technology: [
    { ticker: "XLK", w: 2.0, name: "Technology Select Sector SPDR" },
  ],
  financials: [
    { ticker: "XLF", w: 2.0, name: "Financial Select Sector SPDR" },
  ],
  energy: [
    { ticker: "XLE", w: 2.0, name: "Energy Select Sector SPDR" },
  ],
  healthcare: [
    { ticker: "XLV", w: 2.0, name: "Health Care Select Sector SPDR" },
  ],
  industrials: [
    { ticker: "XLI", w: 2.0, name: "Industrial Select Sector SPDR" },
  ],
  consumer_staples: [
    { ticker: "XLP", w: 2.0, name: "Consumer Staples Select Sector SPDR" },
  ],
  consumer_discretionary: [
    { ticker: "XLY", w: 2.0, name: "Consumer Discretionary Select Sector SPDR" },
  ],
  materials: [
    { ticker: "XLB", w: 2.0, name: "Materials Select Sector SPDR" },
  ],
  real_estate: [
    { ticker: "XLRE", w: 2.0, name: "Real Estate Select Sector SPDR" },
  ],
  utilities: [
    { ticker: "XLU", w: 2.0, name: "Utilities Select Sector SPDR" },
  ],
  communication_services: [
    { ticker: "XLC", w: 2.0, name: "Communication Services Select Sector SPDR" },
  ],
};
