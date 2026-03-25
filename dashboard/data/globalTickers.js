// Global market ticker registries for market awareness features.
// All tickers are US-listed (Yahoo Finance compatible).

/** 8 regional index ETFs for the Market Thermometer */
export const GLOBAL_INDEX_ETFS = [
  { code: "SPY",  name: "S&P 500",        region: "US", exchange: "US", currency: "USD" },
  { code: "QQQ",  name: "Nasdaq 100",     region: "US", exchange: "US", currency: "USD" },
  { code: "EWJ",  name: "Japan (MSCI)",   region: "JP", exchange: "US", currency: "USD" },
  { code: "VGK",  name: "Europe (FTSE)",  region: "EU", exchange: "US", currency: "USD" },
  { code: "EEM",  name: "Emerging Mkts",  region: "EM", exchange: "US", currency: "USD" },
  { code: "FXI",  name: "China Large-Cap", region: "CN", exchange: "US", currency: "USD" },
  { code: "EWZ",  name: "Brazil",         region: "BR", exchange: "US", currency: "USD" },
  { code: "INDA", name: "India",          region: "IN", exchange: "US", currency: "USD" },
];

/** 5 macro instruments for the Macro Regime Layer */
export const MACRO_TICKERS = [
  { code: "USDJPY=X",  name: "USD/JPY",       type: "fx" },
  { code: "^VIX",      name: "VIX",           type: "volatility" },
  { code: "^TNX",      name: "US 10Y Yield",  type: "bond" },
  { code: "DX-Y.NYB",  name: "Dollar Index",  type: "fx" },
  { code: "CL=F",      name: "WTI Crude Oil", type: "commodity" },
];

/** ~25 ETFs for the Opportunistic ETF Scanner (entry signals) */
export const GLOBAL_SCAN_ETFS = [
  // Regional indices (same as thermometer)
  ...GLOBAL_INDEX_ETFS,
  // US sector ETFs (SPDR)
  { code: "XLK",  name: "US Technology",     region: "US", exchange: "US", currency: "USD" },
  { code: "XLF",  name: "US Financials",     region: "US", exchange: "US", currency: "USD" },
  { code: "XLE",  name: "US Energy",         region: "US", exchange: "US", currency: "USD" },
  { code: "XLV",  name: "US Healthcare",     region: "US", exchange: "US", currency: "USD" },
  { code: "XLI",  name: "US Industrials",    region: "US", exchange: "US", currency: "USD" },
  { code: "XLP",  name: "US Consumer Staples", region: "US", exchange: "US", currency: "USD" },
  { code: "XLY",  name: "US Consumer Disc",  region: "US", exchange: "US", currency: "USD" },
  { code: "XLB",  name: "US Materials",      region: "US", exchange: "US", currency: "USD" },
  { code: "XLRE", name: "US Real Estate",    region: "US", exchange: "US", currency: "USD" },
  { code: "XLU",  name: "US Utilities",      region: "US", exchange: "US", currency: "USD" },
  { code: "XLC",  name: "US Communication",  region: "US", exchange: "US", currency: "USD" },
  // Commodities & bonds
  { code: "GLD",  name: "Gold",              region: "GL", exchange: "US", currency: "USD" },
  { code: "SLV",  name: "Silver",            region: "GL", exchange: "US", currency: "USD" },
  { code: "TLT",  name: "20Y+ Treasury",     region: "US", exchange: "US", currency: "USD" },
  { code: "IEF",  name: "7-10Y Treasury",    region: "US", exchange: "US", currency: "USD" },
  // Small cap / value
  { code: "IWM",  name: "Russell 2000",      region: "US", exchange: "US", currency: "USD" },
  { code: "VTV",  name: "US Value",          region: "US", exchange: "US", currency: "USD" },
];

/** 11 US sector ETFs for Relative Strength Overlay (SPDR GICS) */
export const US_SECTOR_ETFS = [
  { code: "XLK",  name: "Technology",         gicsSector: "technology" },
  { code: "XLF",  name: "Financials",         gicsSector: "financials" },
  { code: "XLE",  name: "Energy",             gicsSector: "energy" },
  { code: "XLV",  name: "Healthcare",         gicsSector: "healthcare" },
  { code: "XLI",  name: "Industrials",        gicsSector: "industrials" },
  { code: "XLP",  name: "Consumer Staples",   gicsSector: "consumer_staples" },
  { code: "XLY",  name: "Consumer Disc",      gicsSector: "consumer_discretionary" },
  { code: "XLB",  name: "Materials",          gicsSector: "materials" },
  { code: "XLRE", name: "Real Estate",        gicsSector: "real_estate" },
  { code: "XLU",  name: "Utilities",          gicsSector: "utilities" },
  { code: "XLC",  name: "Communication Svcs", gicsSector: "communication_services" },
];

/** Mapping from JP sector IDs → US GICS sector IDs for cross-market comparison */
export const SECTOR_PAIRS = {
  electric_appliances_precision: "technology",
  it_services_others: "technology",
  banks: "financials",
  financials_ex_banks: "financials",
  automobiles_transportation_equipment: "consumer_discretionary",
  retail_trade: "consumer_discretionary",
  pharmaceutical: "healthcare",
  raw_materials_chemicals: "materials",
  steel_nonferrous_metals: "materials",
  construction_materials: "materials",
  energy_resources: "energy",
  machinery: "industrials",
  transportation_logistics: "industrials",
  electric_power_gas: "utilities",
  real_estate: "real_estate",
  foods: "consumer_staples",
  commercial_wholesale_trade: "industrials",
};
