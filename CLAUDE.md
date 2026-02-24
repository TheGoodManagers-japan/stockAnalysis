# stockAnalysis — Claude Code Instructions

## Project Overview

Japanese stock analysis platform that scans ~570 JPX-listed stocks for swing trade entry signals.

**Next.js Dashboard** (`/dashboard`) — self-contained app with PostgreSQL, deployed on Modal.

The analysis engine lives in `dashboard/engine/`, with the canonical source modules in `public/scripts/`.

---

## Architecture

### Next.js Dashboard

```
dashboard/
  app/              → Next.js App Router pages + API routes
  components/       → React components (Header, Sidebar, ScannerTable, PriceChart)
  engine/           → Refactored analysis engine (ESM)
    orchestrator.js → Main scan loop
    helpers.js      → Shared utilities
    analysis/       → bpb, breakout, dip, deepMarketAnalysis, sentiment, etc.
    scoring/        → enrichForTechnicalScore, scanAnalytics
    regime/         → regimeLabels (STRONG_UP / UP / RANGE / DOWN)
    trade/          → tradeManagement (V3 signal)
    sector/         → sectorRotationMonitor
    ml/             → LSTM predictions
  data/             → tickers.js, nikkeiStocks.js, config.js
  lib/
    db.js           → PostgreSQL pool (pg)
    cache.js        → Price history cache (Postgres + Yahoo fallback)
    yahoo.js        → Yahoo Finance data layer
    schema.sql      → Full PostgreSQL schema (16 tables)
    seed.js         → DB seeder
  scripts/
    run-scan.js     → CLI scan runner
```

- Database: PostgreSQL (Neon/Supabase)
- Deployment: Modal (modal_app.py builds from Dockerfile)
- Framework: Next.js 16 + React 19

### Shared Analysis Engine

```
public/scripts/
  core/             → Analysis modules (canonical source)
    main.js         → fetchStockAnalysis, getTradeManagementSignal_V3, enrichForTechnicalScore
    swingTradeEntryTiming.js → analyzeDipEntry (DIP/BREAKOUT/RETEST/RECLAIM/INSIDE)
    techFundValAnalysis.js   → fundamentalScore, valuationScore, tier, valueQuadrant
    marketSentimentOrchestrator.js → short-term + long-term sentiment
    sectorRotationMonitor.js → sector rotation analysis
    deepMarketAnalysis.js    → deep market regime analysis
    bpb.js, breakout.js, dip.js, rrp.js, spc.js, oxr.js → entry pattern detectors
    exit_profiles.js         → exit profile analysis
  scoring/          → computeScore.js, stockDataProcessing.js
  shared/           → api.js, fetcher.js, header.js, utils.js
  data/             → config.js (balanced/strict/loose modes), tickers.js, nikkeiStocks.js
  backtest/         → backtest.js, branch-scorer.js, setup.js
  ml/               → ml.js, modelTraining.js, predictPriceChange.js
```

---

## Key Data Flow

1. **Scan** triggers `fetchStockAnalysis()` with ticker list + portfolio
2. For each ticker:
   - Fetch Yahoo fundamentals (direct `yahoo-finance2` via dashboard lib)
   - Fetch 3yr historical OHLCV (cached from Postgres)
   - Append synthetic "today" candle from live quote
   - `enrichForTechnicalScore()` — fill missing MA, RSI, MACD, Bollinger, Stochastic, ATR, OBV
   - Score: `getAdvancedFundamentalScore()` (0-10), `getValuationScore()` (0-10), `getNumericTier()` (1-3)
   - `getComprehensiveMarketSentiment()` → shortTerm/longTerm scores
   - `analyzeDipEntry()` → buyNow, stopLoss, priceTarget, trigger type, reason
   - If in portfolio: `getTradeManagementSignal_V3()` → Hold/Protect/Sell/Scale
3. Results stored in PostgreSQL via DB insert

---

## Database Schema (PostgreSQL)

Key tables: `tickers`, `price_history`, `stock_snapshots`, `scan_runs`, `scan_results`, `sector_rotation_snapshots`, `portfolio_holdings`, `portfolio_snapshots`, `backtest_runs`, `backtest_trades`, `news_articles`, `news_article_tickers`, `news_watchlist`, `news_analysis_cache`, `predictions`, `trade_journal`

Schema file: `dashboard/lib/schema.sql`

---

## Environment Variables

### Dashboard (.env.local)
- `DATABASE_URL` — PostgreSQL connection string
- `JQUANTS_EMAIL`, `JQUANTS_PASSWORD` — J-Quants API for JP disclosures
- `GEMINI_API_KEY` — Google Gemini for news sentiment analysis

### Modal (modal_app.py)
- Secrets: `stock-analysis-db` (DATABASE_URL), `stock-analysis-api` (JQUANTS + GEMINI)

---

## External APIs & Services

| Service | Purpose | Rate Limits |
|---------|---------|-------------|
| Yahoo Finance (yahoo-finance2) | Quotes, historical prices, fundamentals | Aggressive throttling — use retry w/ exponential backoff + jitter |
| J-Quants API | JP company disclosures (TDnet) | Auth via email/password → refreshToken → idToken |
| Google Gemini | News sentiment analysis | Per-key quota |
| Modal | Dashboard hosting (containerized) | |

---

## Conventions

- **Ticker format**: Always `XXXX.T` (JPX suffix). Input normalization strips other suffixes.
- **Prices**: JPY. Tick sizes inferred from price level.
- **Regime labels**: STRONG_UP, UP, RANGE, DOWN — based on MA25 slope + MA25/MA75 relationship
- **Entry triggers**: DIP, BREAKOUT, RETEST, RECLAIM, INSIDE — from `analyzeDipEntry()`
- **Trade management signals**: Hold, Protect Profit, Sell Now, Scale Partial
- **Value tiers**: 1 (best) to 3 — from fundamental + valuation scores
- **Config modes**: balanced (default), strict, loose — in `data/config.js`
- **ESM modules**: All `public/scripts/` and `dashboard/` files use ES module syntax (`import`/`export`)

---

## Yahoo Finance Throttling

Yahoo aggressively rate-limits. Every Yahoo call implements:
- `withRetry(fn, { retries: 4, baseMs: 500 })` — exponential backoff
- `isThrottleError(err)` — detects 429, "Too Many Requests", crumb errors
- Sleep jitter between sequential calls (150-350ms)
- Returns HTTP 429 to caller when throttled

---

## Important Gotchas

1. `public/scripts/core/main.js` runs in BOTH browser and Node — guard browser globals with `IS_BROWSER`
2. Stop-loss logic is **ratchet-only** (can only tighten, never loosen)
3. The `historicalData` array has a synthetic "today" candle appended; `dataForGates` excludes it
4. Don't add `.T` suffix twice — `normalizeTicker()` handles this
5. `kabutan.js` is a **browser bookmarklet** for scraping kabutan.jp news (paste into DevTools)
6. `modal_app.py` uses Modal's container runtime to deploy the Next.js dashboard

---

## Development Commands

```bash
# Dashboard (port 3002)
cd dashboard
npm run dev              # next dev --port 3002
npm run build            # next build
npm start                # next start

# Modal deployment
modal deploy modal_app.py
```

---

## File Naming

- Analysis modules: camelCase (e.g., `swingTradeEntryTiming.js`)
- Data files: camelCase (e.g., `nikkeiStocks.js`)
- API routes (dashboard): `route.js` inside App Router folders
- Components: PascalCase (e.g., `ScannerTable.jsx`)
