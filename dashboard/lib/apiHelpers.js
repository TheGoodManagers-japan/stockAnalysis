// Shared API route response helpers
import { NextResponse } from "next/server";

/** Standard success response */
export function ok(data) {
  return NextResponse.json({ success: true, ...data });
}

/** Standard error response */
export function fail(message, status = 500) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/** Handle Yahoo-specific throttle errors, returns appropriate NextResponse */
export function handleYahooError(error, fallbackMessage = "handler error") {
  if (
    error?.name === "YahooThrottleError" ||
    error?.code === "YAHOO_THROTTLED"
  ) {
    return NextResponse.json(
      {
        success: false,
        message: error?.message || "Yahoo Finance throttled",
        code: "YAHOO_THROTTLED",
      },
      { status: 429 }
    );
  }
  const status = error?.name === "DataIntegrityError" ? 422 : 500;
  return NextResponse.json(
    { success: false, message: error?.message || fallbackMessage },
    { status }
  );
}
