import { NextResponse } from "next/server";
import { query } from "../../../../lib/db.js";
import { computeRelativeStrengthOverlay } from "../../../../engine/global/relativeStrengthOverlay.js";

/**
 * GET /api/sector-rotation/cross-market
 * Compare JP vs US sector rotation data.
 */
export async function GET() {
  try {
    // Get latest JP sector data
    const jpResult = await query(
      `SELECT * FROM sector_rotation_snapshots
       WHERE (market IS NULL OR market = 'JP')
         AND scan_date = (
           SELECT MAX(scan_date) FROM sector_rotation_snapshots
           WHERE market IS NULL OR market = 'JP'
         )
       ORDER BY composite_score DESC`
    );

    // Get latest US sector data
    const usResult = await query(
      `SELECT * FROM sector_rotation_snapshots
       WHERE market = 'US'
         AND scan_date = (
           SELECT MAX(scan_date) FROM sector_rotation_snapshots WHERE market = 'US'
         )
       ORDER BY composite_score DESC`
    );

    const overlay = computeRelativeStrengthOverlay(jpResult.rows, usResult.rows);

    return NextResponse.json({
      ...overlay,
      jpScanDate: jpResult.rows[0]?.scan_date || null,
      usScanDate: usResult.rows[0]?.scan_date || null,
      jpSectorCount: jpResult.rows.length,
      usSectorCount: usResult.rows.length,
    });
  } catch (err) {
    console.error("[API] GET /api/sector-rotation/cross-market error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
