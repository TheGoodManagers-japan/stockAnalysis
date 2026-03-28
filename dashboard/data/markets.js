// Market registry — single source of truth for all supported markets
export const MARKETS = {
  JP: {
    code: "JP",
    name: "Japan (JPX)",
    currency: "JPY",
    exchange: "JPX",
    regimeTicker: "1306.T",
    newsEnabled: true,
    mlEnabled: true,
  },
  US: {
    code: "US",
    name: "US (S&P 500)",
    currency: "USD",
    exchange: "NYSE/NASDAQ",
    regimeTicker: "SPY",
    newsEnabled: false,
    mlEnabled: false,
  },
  EU: {
    code: "EU",
    name: "Europe (Euro Stoxx 50)",
    currency: "EUR",
    exchange: "EURONEXT",
    regimeTicker: "VGK",
    newsEnabled: false,
    mlEnabled: false,
  },
  UK: {
    code: "UK",
    name: "UK (FTSE 100)",
    currency: "GBP",
    exchange: "LSE",
    regimeTicker: "ISF.L",
    newsEnabled: false,
    mlEnabled: false,
  },
  CN: {
    code: "CN",
    name: "China (Hang Seng)",
    currency: "HKD",
    exchange: "HKEX",
    regimeTicker: "FXI",
    newsEnabled: false,
    mlEnabled: false,
  },
  IN: {
    code: "IN",
    name: "India (Nifty 50)",
    currency: "INR",
    exchange: "NSE",
    regimeTicker: "INDA",
    newsEnabled: false,
    mlEnabled: false,
  },
  KR: {
    code: "KR",
    name: "Korea (KOSPI 50)",
    currency: "KRW",
    exchange: "KRX",
    regimeTicker: "EWY",
    newsEnabled: false,
    mlEnabled: false,
  },
};

export const MARKET_CODES = Object.keys(MARKETS);
export const DEFAULT_MARKET = "JP";

export function getMarket(code) {
  return MARKETS[code?.toUpperCase()] || MARKETS.JP;
}
