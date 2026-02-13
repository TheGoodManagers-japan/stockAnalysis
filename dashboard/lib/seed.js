/**
 * seed.js — Seeds the tickers table from the existing tickers.js data file.
 *
 * Usage: node lib/seed.js
 *
 * Prerequisites: DATABASE_URL environment variable must be set.
 */

const pg = require("pg");
const { readFileSync } = require("fs");
const { resolve } = require("path");

const schemaPath = resolve(__dirname, "schema.sql");
const tickersFilePath = resolve(__dirname, "../data/tickers.js");

function loadTickers() {
  const content = readFileSync(tickersFilePath, "utf-8");

  const tickers = [];
  const regex = /\{\s*code\s*:\s*"([^"]+)"\s*,\s*sector\s*:\s*"([^"]+)"\s*,?\s*\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    tickers.push({ code: match[1], sector: match[2] });
  }
  return tickers;
}

async function seed() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/stockanalysis";

  const pool = new pg.Pool({ connectionString: databaseUrl });

  try {
    console.log("Connecting to database...");

    // Run schema
    const schema = readFileSync(schemaPath, "utf-8");
    await pool.query(schema);
    console.log("Schema created/updated.");

    // Load and insert tickers
    const tickers = loadTickers();
    console.log(`Found ${tickers.length} tickers to seed.`);

    if (tickers.length === 0) {
      console.error("No tickers found! Check the tickers.js file path.");
      process.exit(1);
    }

    // Use upsert to avoid duplicates
    let inserted = 0;
    for (const t of tickers) {
      const result = await pool.query(
        `INSERT INTO tickers (code, sector)
         VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET sector = EXCLUDED.sector, updated_at = NOW()
         RETURNING code`,
        [t.code, t.sector]
      );
      if (result.rowCount > 0) inserted++;
    }

    console.log(`Seeded ${inserted} tickers.`);

    // Verify
    const count = await pool.query("SELECT COUNT(*) FROM tickers");
    console.log(`Total tickers in database: ${count.rows[0].count}`);

    const sectorCount = await pool.query(
      "SELECT sector, COUNT(*) as cnt FROM tickers GROUP BY sector ORDER BY cnt DESC"
    );
    console.log("\nTickers per sector:");
    for (const row of sectorCount.rows) {
      console.log(`  ${row.sector}: ${row.cnt}`);
    }
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
