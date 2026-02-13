import { NextResponse } from "next/server";
import { query } from "../../../lib/db.js";
import { analyzeSectorRotation, sectorPoolsJP } from "../../../engine/sector/sectorRotationMonitor.js";
import { getCachedHistory } from "../../../lib/cache.js";

/**
 * Ensure benchmark + sector pool tickers exist in the tickers table.
 */
async function ensureSectorTickers() {
  const needed = new Set(["1306.T"]);
  for (const members of Object.values(sectorPoolsJP)) {
    for (const m of members) {
      const t = m.ticker.endsWith(".T") ? m.ticker : `${m.ticker}.T`;
      needed.add(t);
    }
  }
  for (const code of needed) {
    await query(
      `INSERT INTO tickers (code, sector, short_name)
       VALUES ($1, 'benchmark', $2)
       ON CONFLICT (code) DO NOTHING`,
      [code, code]
    );
  }
}

/**
 * Custom fetch function that bypasses HTTP and reads directly from the
 * PostgreSQL cache via getCachedHistory. This avoids the overhead of
 * the sector monitor calling /api/history over HTTP for every ticker.
 */
async function dbFetch(url) {
  const u = new URL(url, "http://localhost");
  const ticker = u.searchParams.get("ticker");
  const years = parseInt(u.searchParams.get("years") || "3", 10);
  const data = await getCachedHistory(ticker, years);
  return {
    ok: true,
    json: async () => data,
  };
}

// GET /api/sector-rotation — fetch latest sector rotation data
export async function GET() {
  try {
    const result = await query(
      `SELECT * FROM sector_rotation_snapshots
       WHERE scan_date = (SELECT MAX(scan_date) FROM sector_rotation_snapshots)
       ORDER BY composite_score DESC`
    );

    return NextResponse.json({
      success: true,
      sectors: result.rows,
      scanDate: result.rows[0]?.scan_date || null,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/sector-rotation — run sector rotation analysis
export async function POST() {
  try {
    await ensureSectorTickers();

    const result = await analyzeSectorRotation({
      fetchFn: dbFetch,
      concurrency: 4,
    });

    // Save each ranked sector to the database
    for (const sector of result.ranked) {
      const recommendation =
        (sector.score ?? 0) >= 70
          ? "Overweight"
          : (sector.score ?? 0) <= 35
          ? "Avoid"
          : "Neutral";

      await query(
        `INSERT INTO sector_rotation_snapshots (
           scan_date, sector_id, composite_score,
           rs_5, rs_10, rs_20, rs_60,
           accel_swing, breadth_5, breadth_10, breadth_20,
           recommendation, details_json
         ) VALUES (
           CURRENT_DATE, $1, $2,
           $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12
         )
         ON CONFLICT (scan_date, sector_id) DO UPDATE SET
           composite_score = EXCLUDED.composite_score,
           rs_5 = EXCLUDED.rs_5,
           rs_10 = EXCLUDED.rs_10,
           rs_20 = EXCLUDED.rs_20,
           rs_60 = EXCLUDED.rs_60,
           accel_swing = EXCLUDED.accel_swing,
           breadth_5 = EXCLUDED.breadth_5,
           breadth_10 = EXCLUDED.breadth_10,
           breadth_20 = EXCLUDED.breadth_20,
           recommendation = EXCLUDED.recommendation,
           details_json = EXCLUDED.details_json`,
        [
          sector.sector,
          sector.score ?? null,
          sector.rs5 ?? null,
          sector.rs10 ?? null,
          sector.rs20 ?? null,
          sector.rs60 ?? null,
          sector.accelSwing ?? null,
          sector.breadth20EW ?? sector.breadth20 ?? null,
          sector.breadth50EW ?? sector.breadth50 ?? null,
          sector.breadth200EW ?? sector.breadth200 ?? null,
          recommendation,
          JSON.stringify({
            leaders: sector.leaders || [],
            momentum:
              (sector.accelSwing ?? 0) > 0 ? "Accelerating" : "Decelerating",
          }),
        ]
      );
    }

    return NextResponse.json({
      success: true,
      sectorCount: result.ranked.length,
      summary: result.summary,
      heatmap: result.heatmap,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
