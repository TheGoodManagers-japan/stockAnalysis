import { NextResponse } from "next/server";
import { getCachedHistory } from "../../../lib/cache.js";

// GET /api/history?ticker=7203.T&years=3
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker")?.trim();
    const years = parseInt(searchParams.get("years") || "3", 10);

    if (!ticker) {
      return NextResponse.json(
        { success: false, message: "Ticker is required" },
        { status: 400 }
      );
    }

    const data = await getCachedHistory(ticker, years);

    if (!data || data.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: `No historical data available for ${ticker}`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (
      error?.name === "YahooThrottleError" ||
      error?.code === "YAHOO_THROTTLED"
    ) {
      return NextResponse.json(
        { success: false, message: "Yahoo Finance throttled this request" },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
