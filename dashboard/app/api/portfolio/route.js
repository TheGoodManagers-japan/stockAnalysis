import { query } from "../../../lib/db";
import { NextResponse } from "next/server";
import { validateTicker, validatePositiveNum } from "../../../lib/validate.js";

// GET /api/portfolio — fetch all holdings
export async function GET() {
  try {
    const open = await query(
      `SELECT * FROM portfolio_holdings WHERE status = 'open' ORDER BY entry_date DESC`
    );
    const closed = await query(
      `SELECT * FROM portfolio_holdings WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 50`
    );

    // News alerts for open positions
    let newsAlerts = {};
    const openTickers = open.rows.map((h) => h.ticker_code);
    if (openTickers.length > 0) {
      const newsResult = await query(
        `SELECT
           nat.ticker_code,
           COUNT(*) as article_count,
           ROUND(AVG(na.sentiment_score)::numeric, 2) as avg_sentiment,
           MAX(na.impact_level) as max_impact,
           (array_agg(COALESCE(na.title, na.title_ja) ORDER BY na.published_at DESC))[1] as latest_headline
         FROM news_article_tickers nat
         JOIN news_articles na ON na.id = nat.article_id
         WHERE nat.ticker_code = ANY($1)
           AND na.is_analyzed = TRUE
           AND na.published_at >= NOW() - INTERVAL '7 days'
         GROUP BY nat.ticker_code`,
        [openTickers]
      );
      for (const row of newsResult.rows) {
        newsAlerts[row.ticker_code] = {
          article_count: Number(row.article_count),
          avg_sentiment: Number(row.avg_sentiment),
          max_impact: row.max_impact,
          latest_headline: row.latest_headline,
        };
      }
    }

    const response = NextResponse.json({
      success: true,
      open: open.rows,
      closed: closed.rows,
      newsAlerts,
    });
    response.headers.set("Cache-Control", "private, max-age=30");
    return response;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST /api/portfolio — add new position
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      ticker_code,
      entry_date,
      entry_price,
      shares,
      initial_stop,
      price_target,
      entry_kind,
      entry_reason,
    } = body;

    if (!ticker_code || !entry_price) {
      return NextResponse.json(
        { success: false, error: "ticker_code and entry_price are required" },
        { status: 400 }
      );
    }

    const tv = validateTicker(ticker_code);
    if (!tv.valid) {
      return NextResponse.json(
        { success: false, error: tv.error },
        { status: 400 }
      );
    }

    const pv = validatePositiveNum(entry_price, "entry_price");
    if (!pv.valid) {
      return NextResponse.json(
        { success: false, error: pv.error },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO portfolio_holdings
       (ticker_code, entry_date, entry_price, shares, initial_stop, current_stop, price_target, entry_kind, entry_reason)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)
       RETURNING *`,
      [
        ticker_code,
        entry_date || new Date().toISOString().split("T")[0],
        entry_price,
        shares || 100,
        initial_stop,
        price_target,
        entry_kind,
        entry_reason,
      ]
    );

    return NextResponse.json({ success: true, holding: result.rows[0] });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// PATCH /api/portfolio — update position (close, update stop, etc.)
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 }
      );
    }

    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = [
      "status",
      "exit_price",
      "exit_reason",
      "closed_at",
      "initial_stop",
      "current_stop",
      "price_target",
      "notes",
    ];

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(updates[key]);
        idx++;
      }
    }

    if (fields.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Compute P&L if closing
    if (updates.status === "closed" && updates.exit_price) {
      const holding = await query(
        `SELECT entry_price, shares FROM portfolio_holdings WHERE id = $1`,
        [id]
      );
      if (holding.rows.length > 0) {
        const h = holding.rows[0];
        const pnlAmount =
          (Number(updates.exit_price) - Number(h.entry_price)) *
          Number(h.shares);
        const pnlPct =
          ((Number(updates.exit_price) - Number(h.entry_price)) /
            Number(h.entry_price)) *
          100;
        fields.push(`pnl_amount = $${idx}`);
        values.push(pnlAmount);
        idx++;
        fields.push(`pnl_pct = $${idx}`);
        values.push(pnlPct);
        idx++;
      }
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE portfolio_holdings SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );

    return NextResponse.json({ success: true, holding: result.rows[0] });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
