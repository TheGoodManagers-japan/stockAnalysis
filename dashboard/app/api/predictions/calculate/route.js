import { query } from "../../../../lib/db.js";
import { predictBatch } from "../../../../engine/ml/lstmV2.js";
import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker");

    if (!ticker) {
      return NextResponse.json(
        { success: false, error: "ticker parameter required" },
        { status: 400 }
      );
    }

    const result = await predictBatch([ticker]);

    if (!result) {
      return NextResponse.json(
        { success: false, error: "No trained LSTM v2 model available" },
        { status: 503 }
      );
    }

    // Check if ticker was skipped
    const skipReason = result.skips.get(ticker);
    if (skipReason) {
      await query(
        `INSERT INTO predictions
           (ticker_code, prediction_date, skip_reason, model_type)
         VALUES ($1, CURRENT_DATE, $2, 'lstm_v2')
         ON CONFLICT (ticker_code, prediction_date) DO UPDATE SET
           skip_reason = EXCLUDED.skip_reason,
           model_type = EXCLUDED.model_type`,
        [ticker, skipReason]
      );
      return NextResponse.json({ success: false, skipReason });
    }

    const pred = result.predictions.get(ticker);
    if (!pred) {
      return NextResponse.json(
        { success: false, error: "No prediction generated" },
        { status: 500 }
      );
    }

    // Insert into predictions table (same upsert as run-scan.js)
    await query(
      `INSERT INTO predictions
         (ticker_code, prediction_date, predicted_max_30d,
          predicted_pct_change, confidence, model_type, current_price,
          predicted_max_5d, predicted_max_10d, predicted_max_20d,
          uncertainty_5d, uncertainty_10d, uncertainty_20d, uncertainty_30d,
          model_version, skip_reason)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, 'lstm_v2', $5,
               $6, $7, $8, $9, $10, $11, $12, $13, NULL)
       ON CONFLICT (ticker_code, prediction_date) DO UPDATE SET
         predicted_max_30d = EXCLUDED.predicted_max_30d,
         predicted_pct_change = EXCLUDED.predicted_pct_change,
         confidence = EXCLUDED.confidence,
         model_type = EXCLUDED.model_type,
         current_price = EXCLUDED.current_price,
         predicted_max_5d = EXCLUDED.predicted_max_5d,
         predicted_max_10d = EXCLUDED.predicted_max_10d,
         predicted_max_20d = EXCLUDED.predicted_max_20d,
         uncertainty_5d = EXCLUDED.uncertainty_5d,
         uncertainty_10d = EXCLUDED.uncertainty_10d,
         uncertainty_20d = EXCLUDED.uncertainty_20d,
         uncertainty_30d = EXCLUDED.uncertainty_30d,
         model_version = EXCLUDED.model_version,
         skip_reason = NULL`,
      [
        ticker,
        pred.predicted_max_30d, pred.predicted_pct_change, pred.confidence,
        pred.current_price,
        pred.predicted_max_5d, pred.predicted_max_10d, pred.predicted_max_20d,
        pred.uncertainty_5d, pred.uncertainty_10d, pred.uncertainty_20d, pred.uncertainty_30d,
        pred.model_version,
      ]
    );

    return NextResponse.json({
      success: true,
      prediction: {
        ticker_code: ticker,
        prediction_date: new Date().toISOString(),
        model_type: "lstm_v2",
        model_version: pred.model_version,
        current_price: pred.current_price,
        predicted_max_5d: pred.predicted_max_5d,
        predicted_max_10d: pred.predicted_max_10d,
        predicted_max_20d: pred.predicted_max_20d,
        predicted_max_30d: pred.predicted_max_30d,
        uncertainty_5d: pred.uncertainty_5d,
        uncertainty_10d: pred.uncertainty_10d,
        uncertainty_20d: pred.uncertainty_20d,
        uncertainty_30d: pred.uncertainty_30d,
        predicted_pct_change: pred.predicted_pct_change,
        confidence: pred.confidence,
        skip_reason: null,
      },
    });
  } catch (err) {
    console.error("ML prediction error:", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
