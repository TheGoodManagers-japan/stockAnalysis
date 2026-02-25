import modal
import subprocess
import os

# ─────────────────────────────────────────────
# Modal App
# ─────────────────────────────────────────────
app = modal.App("stock-analysis")

# ─────────────────────────────────────────────
# Container Image
# ─────────────────────────────────────────────
image = modal.Image.from_dockerfile(
    "./dashboard/Dockerfile",
    context_dir="./dashboard",
    add_python="3.11",
).pip_install("psycopg2-binary").env({
    "NODE_ENV": "production",
    "PORT": "3000",
    "HOSTNAME": "0.0.0.0",
})

# ─────────────────────────────────────────────
# Secrets (configured via Modal Dashboard)
# Create at: https://modal.com/secrets
#
# "jp-scanner-secrets":
#   DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
#   JQUANTS_EMAIL=...
#   JQUANTS_PASSWORD=...
#   GEMINI_API_KEY=...
# ─────────────────────────────────────────────
secrets = modal.Secret.from_name(
    "jp-scanner-secrets",
    required_keys=["DATABASE_URL", "JQUANTS_EMAIL", "JQUANTS_PASSWORD", "GEMINI_API_KEY"],
)


# ─────────────────────────────────────────────
# Web Endpoint: Next.js Dashboard
# ─────────────────────────────────────────────
@app.function(
    image=image,
    secrets=[secrets],
    cpu=2.0,
    memory=2048,
    timeout=86400,
    scaledown_window=300,
)
@modal.concurrent(max_inputs=100)
@modal.web_server(3000, startup_timeout=120, label="dashboard")
def dashboard():
    """Start the Next.js production server."""
    subprocess.Popen(
        ["node", "server.js"],
        cwd="/app",
        env={**os.environ, "PORT": "3000", "HOSTNAME": "0.0.0.0"},
    )


# ─────────────────────────────────────────────
# Cron Job: Daily Stock Scanner
# Runs at 21:30 UTC (06:30 JST) Sun-Thu = Mon-Fri mornings in JST
# ─────────────────────────────────────────────
@app.function(
    image=image,
    secrets=[secrets],
    cpu=1.0,
    memory=2048,
    timeout=3600,
    retries=modal.Retries(
        max_retries=2,
        initial_delay=60.0,
        backoff_coefficient=2.0,
    ),
    schedule=modal.Cron("30 21 * * 0-4", timezone="UTC"),
)
def daily_scan():
    """Run the full stock scanner before Tokyo market open (6:30 JST)."""
    result = subprocess.run(
        ["node", "scripts/run-scan.js"],
        cwd="/app",
        capture_output=True,
        text=True,
        timeout=3300,
        env={**os.environ, "DASHBOARD_URL": "https://info-27641--dashboard.modal.run"},
    )
    print(result.stdout)
    if result.returncode != 0:
        print("STDERR:", result.stderr)
        raise Exception(f"Scan failed with exit code {result.returncode}")


# ─────────────────────────────────────────────
# Migration Utility
# ─────────────────────────────────────────────
@app.function(
    image=image,
    secrets=[secrets],
    cpu=1.0,
    memory=1024,
    timeout=600,
)
def migrate_db():
    """Run database migrations."""
    import psycopg2

    db_url = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()

    # Schema migrations — add missing columns
    migrations = [
        ("scan_results", "is_value_candidate", "ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS is_value_candidate BOOLEAN DEFAULT FALSE"),
        ("scan_results", "value_play_score", "ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS value_play_score NUMERIC(5,1)"),
        ("scan_results", "value_play_grade", "ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS value_play_grade TEXT"),
        ("scan_results", "value_play_class", "ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS value_play_class TEXT"),
        ("scan_results", "value_play_json", "ALTER TABLE scan_results ADD COLUMN IF NOT EXISTS value_play_json JSONB"),
        ("ai_reviews", "confidence", "ALTER TABLE ai_reviews ADD COLUMN IF NOT EXISTS confidence INTEGER"),
    ]

    for table, col, sql in migrations:
        try:
            cur.execute(sql)
            print(f"  ✓ {table}.{col}")
        except Exception as e:
            print(f"  ✗ {table}.{col}: {e}")

    # Create index
    try:
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scan_results_value_play ON scan_results(is_value_candidate, scan_date DESC)")
        print("  ✓ idx_scan_results_value_play index")
    except Exception as e:
        print(f"  ✗ index: {e}")

    # Create predictions table if missing (needed for ML Phase 3 LSTM v2)
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS predictions (
                id                  BIGSERIAL PRIMARY KEY,
                scan_id             UUID REFERENCES scan_runs(scan_id),
                ticker_code         TEXT NOT NULL REFERENCES tickers(code),
                prediction_date     DATE NOT NULL DEFAULT CURRENT_DATE,
                predicted_max_30d   NUMERIC(14,4),
                predicted_pct_change NUMERIC(8,4),
                confidence          NUMERIC(4,2),
                model_type          TEXT DEFAULT 'lstm',
                current_price       NUMERIC(14,4),
                predicted_max_5d    NUMERIC(14,4),
                predicted_max_10d   NUMERIC(14,4),
                predicted_max_20d   NUMERIC(14,4),
                uncertainty_5d      NUMERIC(8,4),
                uncertainty_10d     NUMERIC(8,4),
                uncertainty_20d     NUMERIC(8,4),
                uncertainty_30d     NUMERIC(8,4),
                model_version       INTEGER,
                created_at          TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(ticker_code, prediction_date)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_predictions_ticker ON predictions(ticker_code, prediction_date DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_predictions_date ON predictions(prediction_date DESC)")
        print("  ✓ predictions table")
    except Exception as e:
        print(f"  ✗ predictions table: {e}")

    # Create ml_rankings table if missing (needed for ML Phase 2 stock ranker)
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ml_rankings (
                id                      BIGSERIAL PRIMARY KEY,
                scan_id                 UUID REFERENCES scan_runs(scan_id),
                ticker_code             TEXT NOT NULL,
                ranking_date            DATE NOT NULL DEFAULT CURRENT_DATE,
                predicted_return_10d    NUMERIC(8,4),
                rank_position           INTEGER,
                model_version           INTEGER,
                created_at              TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(ticker_code, ranking_date)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ml_rankings_date ON ml_rankings(ranking_date DESC, rank_position ASC)")
        print("  ✓ ml_rankings table")
    except Exception as e:
        print(f"  ✗ ml_rankings table: {e}")

    cur.close()
    conn.close()
    print("Schema migration complete.")

    # Run ai_reviews migration
    print("\nRunning ai_reviews migration (init-db-reviews.js)...")
    result = subprocess.run(
        ["node", "scripts/init-db-reviews.js"],
        cwd="/app",
        capture_output=True,
        text=True,
        timeout=300,
        env={**os.environ},
    )
    print(result.stdout)
    if result.returncode != 0:
        print("STDERR:", result.stderr)
        raise Exception(f"Migration failed with exit code {result.returncode}")





