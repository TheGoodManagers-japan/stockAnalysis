import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";

// In-memory lock to prevent double-spawns before the script creates its scan_run
let lastSpawnedAt = 0;

// POST /api/scan/run-script — spawn run-scan.js as a child process
// This runs the full pipeline: news fetch → scan → ML → Discord report
export async function POST() {
  try {
    // In-memory guard: reject if spawned within last 30 seconds
    if (Date.now() - lastSpawnedAt < 30000) {
      return NextResponse.json(
        { success: false, error: "Scan script was just started, please wait" },
        { status: 409 }
      );
    }

    // Check for already-running scan in DB
    const running = await query(
      `SELECT scan_id FROM scan_runs
       WHERE status = 'running'
         AND started_at > NOW() - INTERVAL '45 minutes'
       LIMIT 1`
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

    const child = cp.spawn("node", ["scripts/run-scan.js"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      detached: true,
    });

    child.unref();

    console.log(`[run-script] Spawned run-scan.js (PID ${child.pid})`);

    return NextResponse.json({ success: true, pid: child.pid });
  } catch (err) {
    console.error("[run-script] Failed to spawn:", err);
    lastSpawnedAt = 0;
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
