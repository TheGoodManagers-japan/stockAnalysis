import { NextResponse } from "next/server";
import { computeSeasonalBias } from "../../../engine/global/seasonalModifier.js";

/**
 * GET /api/calendar
 * Returns active and upcoming seasonal events + central bank meetings.
 */
export async function GET() {
  try {
    const bias = computeSeasonalBias(new Date());
    return NextResponse.json(bias);
  } catch (err) {
    console.error("[API] GET /api/calendar error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
