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
        env={**os.environ},
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
    print("Running database migration (init-db-reviews.js)...")
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





