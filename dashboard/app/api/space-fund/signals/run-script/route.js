import { NextResponse } from "next/server";

// In-memory lock to prevent double-spawns
let lastSpawnedAt = 0;

// POST /api/space-fund/signals/run-script — spawn run-space-fund-signals.js
// This runs the full pipeline: US news fetch → signals → Discord report
export async function POST(request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = request.headers.get("authorization");
      if (auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Reject if spawned within last 30 seconds
    if (Date.now() - lastSpawnedAt < 30000) {
      return NextResponse.json(
        { success: false, error: "Signal script was just started, please wait" },
        { status: 409 }
      );
    }

    lastSpawnedAt = Date.now();

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
    lastSpawnedAt = 0;
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
