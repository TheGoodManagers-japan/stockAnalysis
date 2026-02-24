import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";

export const dynamic = "force-dynamic";

// GET: model status
export async function GET() {
  try {
    const result = await query(
      `SELECT model_name, model_version, training_samples, trained_at, metrics, is_active
       FROM ml_models
       WHERE is_active = TRUE
       ORDER BY model_name`
    );

    return NextResponse.json({
      models: result.rows.map((r) => ({
        name: r.model_name,
        version: r.model_version,
        trainingSamples: r.training_samples,
        trainedAt: r.trained_at,
        metrics: typeof r.metrics === "string" ? JSON.parse(r.metrics) : r.metrics,
        isActive: r.is_active,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
