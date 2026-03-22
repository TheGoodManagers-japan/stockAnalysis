import { NextResponse } from "next/server";

// POST /api/space-fund/signals/run-script — spawn run-space-fund-signals.js
// This runs the full pipeline: US news fetch → signals → Discord report
export async function POST() {
  try {
    // Use eval to hide from Turbopack static analysis
    const cp = eval('require')('child_process');

    const child = cp.spawn("node", ["scripts/run-space-fund-signals.js"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "ignore",
      detached: true,
    });

    child.unref();

    console.log(`[run-script] Spawned run-space-fund-signals.js (PID ${child.pid})`);

    return NextResponse.json({ success: true, pid: child.pid });
  } catch (err) {
    console.error("[run-script] Failed to spawn:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
