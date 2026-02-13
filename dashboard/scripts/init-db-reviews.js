const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error("Missing DATABASE_URL environment variable");
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
});

async function migrate() {
    console.log("Creating ai_reviews table...");
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_reviews (
          id SERIAL PRIMARY KEY,
          scan_id UUID REFERENCES scan_runs(scan_id),
          ticker_code TEXT NOT NULL,
          verdict TEXT,
          reason TEXT,
          full_analysis JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(scan_id, ticker_code)
      );
    `);
        console.log("✅ ai_reviews table created successfully.");
    } catch (err) {
        console.error("❌ Failed to create table:", err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
