import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { MARKET_CODES } from "../../../../data/markets";

// In-memory lock to prevent double-spawns before the script creates its scan_run
let lastSpawnedAt = 0;

// POST /api/scan/run-script — spawn run-scan.js as a child process
// Accepts { market: "JP" | "US" | "EU" | ... } in request body
export async function POST(request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = request.headers.get("authorization");
      const fetchSite = request.headers.get("sec-fetch-site");
      // Allow: Bearer token (cron/GitHub Actions) OR same-origin browser requests (dashboard UI)
      if (auth !== `Bearer ${cronSecret}` && fetchSite !== "same-origin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Parse market from request body
    let market = "JP";
    try {
      const body = await request.json().catch(() => ({}));
      if (body.market && MARKET_CODES.includes(body.market.toUpperCase())) {
        market = body.market.toUpperCase();
      }
    } catch {}

    // In-memory guard: reject if spawned within last 30 seconds
    if (Date.now() - lastSpawnedAt < 30000) {
      return NextResponse.json(
        { success: false, error: "Scan script was just started, please wait" },
        { status: 409 }
      );
    }

    // Check for already-running scan for this market in DB
    const running = await query(
      `SELECT scan_id FROM scan_runs
       WHERE status = 'running'
         AND started_at > NOW() - INTERVAL '45 minutes'
         AND (market = $1 OR market IS NULL)
       LIMIT 1`,
      [market]
    );
    if (running.rows.length > 0) {
      return NextResponse.json(
        { success: false, error: "Scan already running", scanId: running.rows[0].scan_id },
        { status: 409 }
      );
    }

    lastSpawnedAt = Date.now();

    // Use eval to hide from Turbopack static analysis
    const cp = eval('require')('child_process');

    const child = cp.spawn("node", ["scripts/run-scan.js", "--market", market], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      detached: true,
    });

    child.unref();

    console.log(`[run-script] Spawned run-scan.js --market ${market} (PID ${child.pid})`);

    return NextResponse.json({ success: true, pid: child.pid, market });
  } catch (err) {
    console.error("[run-script] Failed to spawn:", err);
    lastSpawnedAt = 0;
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
