import { NextResponse } from "next/server";

// GET /api/space-fund/signals/progress — read progress from temp file
export async function GET() {
  try {
    const fs = eval('require')('fs');
    const path = eval('require')('path');
    const filePath = path.join(process.cwd(), ".tmp", "sf-progress.json");

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: true, progress: null });
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const progress = JSON.parse(raw);

    return NextResponse.json({ success: true, progress });
  } catch {
    return NextResponse.json({ success: true, progress: null });
  }
}
