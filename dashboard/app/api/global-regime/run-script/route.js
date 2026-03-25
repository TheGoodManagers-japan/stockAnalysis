import { NextResponse } from "next/server";

// In-memory lock to prevent double-spawns
let lastSpawnedAt = 0;

// POST /api/global-regime/run-script — spawn run-global-markets.js as a child process
// This runs the full pipeline: regime scan → ETF signals
export async function POST() {
  try {
    // Reject if spawned within last 30 seconds
    if (Date.now() - lastSpawnedAt < 30000) {
      return NextResponse.json(
        { success: false, error: "Global scan was just started, please wait" },
        { status: 409 }
      );
    }

    lastSpawnedAt = Date.now();

    const cp = eval('require')('child_process');

    const child = cp.spawn("node", ["scripts/run-global-markets.js"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      detached: true,
    });

    child.unref();

    console.log(`[global-run-script] Spawned run-global-markets.js (PID ${child.pid})`);

    return NextResponse.json({ success: true, pid: child.pid });
  } catch (err) {
    console.error("[global-run-script] Failed to spawn:", err);
    lastSpawnedAt = 0;
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
