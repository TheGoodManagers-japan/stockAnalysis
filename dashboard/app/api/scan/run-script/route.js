import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";

// POST /api/scan/run-script — spawn run-scan.js as a child process
// This runs the full pipeline: news fetch → scan → ML → Discord report
export async function POST() {
  try {
    // Check for already-running scan
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

    // Use eval to hide from Turbopack static analysis
    const cp = eval('require')('child_process');

    const child = cp.spawn("node", ["scripts/run-scan.js"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "ignore",
      detached: true,
    });

    child.unref();

    console.log(`[run-script] Spawned run-scan.js (PID ${child.pid})`);

    return NextResponse.json({ success: true, pid: child.pid });
  } catch (err) {
    console.error("[run-script] Failed to spawn:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
