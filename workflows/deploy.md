# Deploy to Railway via GitHub

## Overview

Railway auto-deploys when you push to the `main` branch on GitHub. The pipeline is:

```
local commit → git push origin main → GitHub → Railway detects push → Docker build → deploy
```

Railway builds from `dashboard/Dockerfile` (multi-stage) and health-checks `/api/health` before routing traffic.

---

## Pre-Push Checklist

### 1. Build locally first

```bash
cd dashboard
npm run build
```

This catches 90% of deploy failures. Common issues:
- **Missing imports** — ESM modules not found at build time
- **Dynamic server usage without `force-dynamic`** — pages that call DB/cookies need `export const dynamic = "force-dynamic"`
- **TypeScript / JSX errors** — malformed components

If the build fails locally, it **will** fail on Railway. Fix before pushing.

### 2. Check what you're committing

```bash
git status
git diff --stat
```

Watch for:
- **`.env*` files** — must NEVER be committed (`.dockerignore` excludes them, but `.gitignore` should too)
- **Large files** — images, model weights, `.tmp/` data
- **`node_modules/`** — should be gitignored
- **Unrelated files** — stray screenshots, notes, temp files in root

### 3. Verify environment variables

Railway env vars are set in the Railway dashboard, not in code. Current required vars:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JQUANTS_EMAIL` | J-Quants API auth |
| `JQUANTS_PASSWORD` | J-Quants API auth |
| `GEMINI_API_KEY` | Google Gemini for news analysis |
| `ANTHROPIC_API_KEY` | Claude API for AI reviews |

If you added a **new** env var in code, you **must** add it in Railway dashboard before deploying, or the feature will silently fail in production.

### 4. Check for new dependencies

If you added packages to `package.json`:
- Make sure `package-lock.json` is committed (Docker runs `npm ci` which requires it)
- Verify the package works in Node 22 (Docker base image is `node:22-slim`)

### 5. Check Dockerfile if you added new directories

The Dockerfile explicitly copies these directories into the production image:

```dockerfile
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/engine ./engine
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/data ./data
COPY --from=builder /app/node_modules ./node_modules
```

If you created a **new top-level directory** inside `dashboard/` that's needed at runtime (not just build time), you must add a `COPY` line to the Dockerfile. Otherwise it won't exist in production.

---

## Push & Deploy

### Standard deploy (auto)

```bash
git add <files>
git commit -m "description of changes"
git push origin main
```

Railway picks up the push automatically and starts building.

### Manual deploy (Railway CLI)

```bash
cd dashboard
railway up
```

Use this for testing deploy without committing, or when auto-deploy is disabled.

---

## Monitor the Deploy

### Railway Dashboard

1. Go to [Railway dashboard](https://railway.com/dashboard)
2. Select the stockAnalysis project
3. Click the web service → **Deployments** tab
4. Watch the build logs in real-time

### What to look for

| Phase | What happens | Common failures |
|-------|-------------|-----------------|
| **Build** | `npm ci` + `npm run build` | Missing deps, import errors, build crashes |
| **Deploy** | Container starts, runs `node server.js` | Missing env vars, port binding issues |
| **Health check** | Railway hits `GET /api/health` | App crash on startup, timeout (120s limit) |

- Green checkmark = deploy succeeded, traffic switched over
- Red X = build or health check failed, **previous version stays live**

### Check logs after deploy

In Railway dashboard → service → **Logs** tab. Look for:
- Startup errors (missing modules, DB connection failures)
- Health check responses
- Cron job output (if using cron service)

---

## Rollback

If a deploy breaks production:

1. **Railway dashboard** → Deployments → click the previous healthy deployment → **Rollback**
2. This instantly reverts to the previous container image
3. Then fix the issue locally, rebuild, and push again

---

## Two-Service Setup

The project runs two Railway services from the same repo:

| Service | Dockerfile | Purpose |
|---------|-----------|---------|
| **Web** | `Dockerfile` | Next.js dashboard (serves UI + API routes) |
| **Cron** | `Dockerfile.cron` | Scheduled jobs (daily scan, space fund signals) |

The cron service schedule (defined in `scripts/crontab`):

| Job | UTC | Local equivalent | Command |
|-----|-----|-----------------|---------|
| JPX scan | 21:30 Sun-Thu | 06:30 JST Mon-Fri | `node scripts/run-scan.js` |
| Space Fund | 12:30 Mon-Fri | 07:30 ET Mon-Fri | `node scripts/run-space-fund-signals.js` |

If you modify `scripts/run-scan.js` or `scripts/run-space-fund-signals.js`, the cron service also needs to redeploy.

---

## Troubleshooting

### Build fails with "Module not found"

- Check the import path — ESM requires file extensions (`.js`) for relative imports
- Verify the module is in `package.json` dependencies (not devDependencies)
- If it's a local file outside `dashboard/`, make sure Next.js standalone output includes it

### Health check timeout (120s)

- App is taking too long to start
- Check if there's heavy initialization running on startup (DB migrations, data loading)
- The health endpoint itself is simple (`{ status: "ok" }`), so the issue is app boot time

### "Cannot find module" at runtime (but build passed)

- The module's directory isn't being `COPY`'d in the Dockerfile
- Standalone output doesn't include all `node_modules` — check `serverExternalPackages` in `next.config.mjs`

### Database connection errors

- Verify `DATABASE_URL` is set in Railway env vars
- Check if the DB allows connections from Railway's IP range
- Connection string format: `postgresql://user:pass@host:5432/dbname?sslmode=require`

### New page shows 404 in production

- App Router pages need to be in `dashboard/app/` directory
- Check if `export const dynamic = "force-dynamic"` is needed
- Verify the route isn't being caught by middleware or rewrites

---

## Quick Reference

```bash
# Full deploy flow
cd dashboard
npm run build                  # verify build passes
cd ..
git add <specific-files>       # stage changes
git commit -m "what changed"   # commit
git push origin main           # triggers Railway auto-deploy

# Check deploy status
# → Railway dashboard → Deployments tab

# Emergency rollback
# → Railway dashboard → Deployments → previous deploy → Rollback
```
