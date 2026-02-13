import { NextResponse } from "next/server";
import { fetchYahooFinanceData } from "../../../lib/yahoo.js";
import { cacheStockSnapshot } from "../../../lib/cache.js";

// POST /api/stocks — fetch single stock data from Yahoo Finance
export async function POST(request) {
  try {
    const body = await request.json();
    const tickerObj = body.ticker || body || {};
    const code = String(tickerObj.code || tickerObj.ticker || "").trim();
    const sector = String(tickerObj.sector || "").trim();

    if (!code) {
      return NextResponse.json(
        { success: false, message: "ticker.code is required" },
        { status: 400 }
      );
    }

    const yahooData = await fetchYahooFinanceData(code, sector);

    // Cache the snapshot
    await cacheStockSnapshot(code, yahooData).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { code, sector, yahooData },
    });
  } catch (error) {
    if (
      error?.name === "YahooThrottleError" ||
      error?.code === "YAHOO_THROTTLED"
    ) {
      return NextResponse.json(
        {
          success: false,
          message: error?.message || "Yahoo Finance throttled this request",
          code: error?.code,
        },
        { status: 429 }
      );
    }

    const status = error?.name === "DataIntegrityError" ? 422 : 500;
    return NextResponse.json(
      { success: false, message: error?.message || "stocks handler error" },
      { status }
    );
  }
}
