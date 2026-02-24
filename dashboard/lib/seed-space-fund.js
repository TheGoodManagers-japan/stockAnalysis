/**
 * seed-space-fund.js — Seeds the space fund members table.
 *
 * Usage: node lib/seed-space-fund.js
 *
 * Prerequisites: DATABASE_URL environment variable must be set.
 */

const pg = require("pg");

const SPACE_FUND_SCHEMA = `
CREATE TABLE IF NOT EXISTS space_fund_members (
    id              BIGSERIAL PRIMARY KEY,
    ticker_code     TEXT NOT NULL,
    short_name      TEXT,
    currency        TEXT NOT NULL DEFAULT 'USD',
    exchange        TEXT NOT NULL DEFAULT 'US',
    target_weight   NUMERIC(6,4) NOT NULL,
    category        TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ticker_code)
);

CREATE TABLE IF NOT EXISTS space_fund_transactions (
    id                  BIGSERIAL PRIMARY KEY,
    ticker_code         TEXT NOT NULL REFERENCES space_fund_members(ticker_code),
    transaction_type    TEXT NOT NULL,
    transaction_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    shares              NUMERIC(14,4) NOT NULL,
    price_per_share     NUMERIC(14,4) NOT NULL,
    total_amount        NUMERIC(16,4) NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'USD',
    fees                NUMERIC(10,4) DEFAULT 0,
    notes               TEXT,
    dca_month           TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sf_transactions_ticker ON space_fund_transactions(ticker_code, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_sf_transactions_date ON space_fund_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_sf_transactions_dca ON space_fund_transactions(dca_month);

CREATE TABLE IF NOT EXISTS space_fund_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    snapshot_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    total_value         NUMERIC(20,4),
    total_cost          NUMERIC(20,4),
    unrealized_pnl      NUMERIC(20,4),
    unrealized_pnl_pct  NUMERIC(8,4),
    usd_jpy_rate        NUMERIC(10,4),
    holdings_json       JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_sf_snapshots_date ON space_fund_snapshots(snapshot_date DESC);
`;

// Active members (9 stocks from the fund)
const ACTIVE_MEMBERS = [
  { ticker_code: "RKLB",  short_name: "Rocket Lab",         category: "Launch",         target_weight: 0.18 },
  { ticker_code: "PL",    short_name: "Planet Labs",         category: "Satellite",      target_weight: 0.12 },
  { ticker_code: "LUNR",  short_name: "Intuitive Machines",  category: "Launch",         target_weight: 0.08 },
  { ticker_code: "RDW",   short_name: "Redwire",             category: "Infrastructure", target_weight: 0.08 },
  { ticker_code: "NVDA",  short_name: "NVIDIA",              category: "Infrastructure", target_weight: 0.14 },
  { ticker_code: "GOOGL", short_name: "Alphabet",            category: "Infrastructure", target_weight: 0.12 },
  { ticker_code: "AVGO",  short_name: "Broadcom",            category: "Infrastructure", target_weight: 0.10 },
  { ticker_code: "LITE",  short_name: "Lumentum Holdings",   category: "Infrastructure", target_weight: 0.09 },
  { ticker_code: "COHR",  short_name: "Coherent Corp",       category: "Infrastructure", target_weight: 0.09 },
];

// Watchlist — seeded as inactive (Tier 1 expansion candidates)
const WATCHLIST_MEMBERS = [
  { ticker_code: "ASTS",  short_name: "AST SpaceMobile",       category: "Satellite", target_weight: 0 },
  { ticker_code: "IRDM",  short_name: "Iridium Communications", category: "Satellite", target_weight: 0 },
  { ticker_code: "KTOS",  short_name: "Kratos Defense",         category: "Defense",   target_weight: 0 },
];

async function seed() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/stockanalysis";

  const pool = new pg.Pool({ connectionString: databaseUrl });

  try {
    console.log("Connecting to database...");

    // Create space fund tables
    await pool.query(SPACE_FUND_SCHEMA);
    console.log("Space fund tables created/verified.");

    // Upsert active members
    let count = 0;
    for (const m of ACTIVE_MEMBERS) {
      await pool.query(
        `INSERT INTO space_fund_members (ticker_code, short_name, currency, exchange, target_weight, category, is_active)
         VALUES ($1, $2, 'USD', 'US', $3, $4, TRUE)
         ON CONFLICT (ticker_code) DO UPDATE SET
           short_name = EXCLUDED.short_name,
           target_weight = EXCLUDED.target_weight,
           category = EXCLUDED.category,
           is_active = TRUE,
           updated_at = NOW()`,
        [m.ticker_code, m.short_name, m.target_weight, m.category]
      );
      count++;
    }
    console.log(`Seeded ${count} active members.`);

    // Upsert watchlist (inactive)
    let watchCount = 0;
    for (const m of WATCHLIST_MEMBERS) {
      await pool.query(
        `INSERT INTO space_fund_members (ticker_code, short_name, currency, exchange, target_weight, category, is_active)
         VALUES ($1, $2, 'USD', 'US', $3, $4, FALSE)
         ON CONFLICT (ticker_code) DO UPDATE SET
           short_name = EXCLUDED.short_name,
           category = EXCLUDED.category,
           updated_at = NOW()`,
        [m.ticker_code, m.short_name, m.target_weight, m.category]
      );
      watchCount++;
    }
    console.log(`Seeded ${watchCount} watchlist members (inactive).`);

    // Verify
    const active = await pool.query(
      "SELECT ticker_code, short_name, category, target_weight, is_active FROM space_fund_members ORDER BY is_active DESC, target_weight DESC"
    );
    console.log("\nAll space fund members:");
    for (const row of active.rows) {
      const pct = (parseFloat(row.target_weight) * 100).toFixed(0);
      const status = row.is_active ? "ACTIVE" : "WATCH";
      console.log(`  [${status}] ${row.ticker_code.padEnd(6)} ${row.short_name.padEnd(25)} ${row.category.padEnd(15)} ${pct}%`);
    }

    const totalWeight = active.rows
      .filter((r) => r.is_active)
      .reduce((sum, r) => sum + parseFloat(r.target_weight), 0);
    console.log(`\nTotal active weight: ${(totalWeight * 100).toFixed(1)}%`);
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
