import { allTickers as jpTickers } from "./tickers.js";
import { allTickers as usTickers } from "./tickers-us.js";
import { allTickers as euTickers } from "./tickers-eu.js";
import { allTickers as ukTickers } from "./tickers-uk.js";
import { allTickers as cnTickers } from "./tickers-cn.js";
import { allTickers as inTickers } from "./tickers-in.js";
import { allTickers as krTickers } from "./tickers-kr.js";

const TICKER_MAP = {
  JP: jpTickers,
  US: usTickers,
  EU: euTickers,
  UK: ukTickers,
  CN: cnTickers,
  IN: inTickers,
  KR: krTickers,
};

export function getTickersForMarket(marketCode) {
  return TICKER_MAP[marketCode?.toUpperCase()] || jpTickers;
}

export { TICKER_MAP };
