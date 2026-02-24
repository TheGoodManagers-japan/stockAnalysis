import { NextResponse } from "next/server";
import { resolveOpenSignals } from "../../../../lib/signalTracker.js";
import YahooFinanceModule from "yahoo-finance2";

const YahooFinance =
  YahooFinanceModule?.default ||
  YahooFinanceModule?.YahooFinance ||
  YahooFinanceModule;
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// POST /api/signal-tracker/resolve — check OPEN trades against current prices
export async function POST() {
  try {
    // Build a quote cache to avoid duplicate fetches for the same ticker
    const quoteCache = new Map();

    const result = await resolveOpenSignals(async (ticker) => {
      if (quoteCache.has(ticker)) return quoteCache.get(ticker);
      try {
        const q = await yahooFinance.quote(ticker);
        await sleep(150 + Math.random() * 200);
        const quote = q
          ? {
              high: q.regularMarketDayHigh || q.regularMarketPrice,
              low: q.regularMarketDayLow || q.regularMarketPrice,
              close: q.regularMarketPrice,
            }
          : null;
        quoteCache.set(ticker, quote);
        return quote;
      } catch {
        quoteCache.set(ticker, null);
        return null;
      }
    });

    return NextResponse.json({
      success: true,
      resolved: result.resolved,
      checked: quoteCache.size,
      errors: result.errors,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
