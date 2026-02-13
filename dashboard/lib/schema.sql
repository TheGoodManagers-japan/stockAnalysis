-- ==========================================
-- Stock Analysis Dashboard — PostgreSQL Schema
-- ==========================================

-- 1. TICKERS (master reference)
CREATE TABLE IF NOT EXISTS tickers (
    code            TEXT PRIMARY KEY,
    sector          TEXT NOT NULL,
    short_name      TEXT,
    currency        TEXT DEFAULT 'JPY',
    exchange        TEXT DEFAULT 'JPX',
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PRICE HISTORY (Yahoo Finance cache)
CREATE TABLE IF NOT EXISTS price_history (
    id              BIGSERIAL PRIMARY KEY,
    ticker_code     TEXT NOT NULL REFERENCES tickers(code),
    date            DATE NOT NULL,
    open            NUMERIC(14,4),
    high            NUMERIC(14,4),
    low             NUMERIC(14,4),
    close           NUMERIC(14,4) NOT NULL,
    volume          BIGINT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ticker_code, date)
);

CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date ON price_history(ticker_code, date DESC);

-- 3. STOCK SNAPSHOTS (fundamental + quote data from Yahoo)
CREATE TABLE IF NOT EXISTS stock_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    ticker_code         TEXT NOT NULL REFERENCES tickers(code),
    snapshot_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    current_price       NUMERIC(14,4),
    open_price          NUMERIC(14,4),
    high_price          NUMERIC(14,4),
    low_price           NUMERIC(14,4),
    prev_close_price    NUMERIC(14,4),
    today_volume        BIGINT,
    market_cap          NUMERIC(20,2),
    pe_ratio            NUMERIC(10,4),
    pb_ratio            NUMERIC(10,4),
    dividend_yield      NUMERIC(8,4),
    dividend_growth_5yr NUMERIC(8,4),
    eps_trailing        NUMERIC(14,4),
    eps_forward         NUMERIC(14,4),
    eps_growth_rate     NUMERIC(10,4),
    debt_equity_ratio   NUMERIC(10,4),
    fifty_two_week_high NUMERIC(14,4),
    fifty_two_week_low  NUMERIC(14,4),
    next_earnings_date  TIMESTAMPTZ,
    rsi_14              NUMERIC(8,4),
    macd                NUMERIC(14,4),
    macd_signal         NUMERIC(14,4),
    bollinger_mid       NUMERIC(14,4),
    bollinger_upper     NUMERIC(14,4),
    bollinger_lower     NUMERIC(14,4),
    stochastic_k        NUMERIC(8,4),
    stochastic_d        NUMERIC(8,4),
    obv                 BIGINT,
    atr_14              NUMERIC(14,4),
    ma_5d               NUMERIC(14,4),
    ma_20d              NUMERIC(14,4),
    ma_25d              NUMERIC(14,4),
    ma_50d              NUMERIC(14,4),
    ma_75d              NUMERIC(14,4),
    ma_200d             NUMERIC(14,4),
    extra_json          JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ticker_code, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_date ON stock_snapshots(snapshot_date DESC);

-- 4. SCAN RUNS (metadata per execution)
CREATE TABLE IF NOT EXISTS scan_runs (
    scan_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at          TIMESTAMPTZ DEFAULT NOW(),
    finished_at         TIMESTAMPTZ,
    ticker_count        INTEGER DEFAULT 0,
    total_tickers       INTEGER DEFAULT 0,
    buy_count           INTEGER DEFAULT 0,
    error_count         INTEGER DEFAULT 0,
    errors              JSONB,
    summary_json        JSONB,
    status              TEXT DEFAULT 'running',
    current_ticker      TEXT
);

-- 5. SCAN RESULTS (analysis output per stock per scan)
CREATE TABLE IF NOT EXISTS scan_results (
    id                      BIGSERIAL PRIMARY KEY,
    scan_id                 UUID NOT NULL REFERENCES scan_runs(scan_id),
    ticker_code             TEXT NOT NULL REFERENCES tickers(code),
    scan_date               TIMESTAMPTZ DEFAULT NOW(),
    current_price           NUMERIC(14,4),
    fundamental_score       NUMERIC(6,2),
    valuation_score         NUMERIC(6,2),
    technical_score         NUMERIC(6,2),
    tier                    SMALLINT,
    value_quadrant          TEXT,
    short_term_score        SMALLINT,
    long_term_score         SMALLINT,
    short_term_bias         TEXT,
    long_term_bias          TEXT,
    short_term_conf         NUMERIC(4,2),
    long_term_conf          NUMERIC(4,2),
    is_buy_now              BOOLEAN DEFAULT FALSE,
    buy_now_reason          TEXT,
    trigger_type            TEXT,
    stop_loss               NUMERIC(14,4),
    price_target            NUMERIC(14,4),
    limit_buy_order         NUMERIC(14,4),
    mgmt_signal_status      TEXT,
    mgmt_signal_reason      TEXT,
    market_regime           TEXT,
    flip_bars_ago           INTEGER,
    golden_cross_bars_ago   INTEGER,
    liq_pass                BOOLEAN,
    liq_adv                 NUMERIC(20,2),
    liq_vol                 NUMERIC(20,2),
    analytics_json          JSONB,
    other_data_json         JSONB,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_results_scan ON scan_results(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_ticker ON scan_results(ticker_code, scan_date DESC);
CREATE INDEX IF NOT EXISTS idx_scan_results_buy ON scan_results(is_buy_now, scan_date DESC);

-- 6. SECTOR ROTATION SNAPSHOTS
CREATE TABLE IF NOT EXISTS sector_rotation_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    scan_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    sector_id           TEXT NOT NULL,
    composite_score     NUMERIC(8,4),
    rs_5                NUMERIC(8,4),
    rs_10               NUMERIC(8,4),
    rs_20               NUMERIC(8,4),
    rs_60               NUMERIC(8,4),
    accel_swing         NUMERIC(8,4),
    breadth_5           NUMERIC(8,4),
    breadth_10          NUMERIC(8,4),
    breadth_20          NUMERIC(8,4),
    recommendation      TEXT,
    details_json        JSONB,
    UNIQUE(scan_date, sector_id)
);

CREATE INDEX IF NOT EXISTS idx_sector_rotation_date ON sector_rotation_snapshots(scan_date DESC);

-- 7. PORTFOLIO HOLDINGS
CREATE TABLE IF NOT EXISTS portfolio_holdings (
    id                  BIGSERIAL PRIMARY KEY,
    ticker_code         TEXT NOT NULL REFERENCES tickers(code),
    entry_date          DATE,
    entry_price         NUMERIC(14,4) NOT NULL,
    shares              INTEGER DEFAULT 100,
    initial_stop        NUMERIC(14,4),
    current_stop        NUMERIC(14,4),
    price_target        NUMERIC(14,4),
    entry_kind          TEXT,
    entry_reason        TEXT,
    status              TEXT DEFAULT 'open',
    closed_at           DATE,
    exit_price          NUMERIC(14,4),
    exit_reason         TEXT,
    pnl_amount          NUMERIC(14,4),
    pnl_pct             NUMERIC(8,4),
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_status ON portfolio_holdings(status);
CREATE INDEX IF NOT EXISTS idx_portfolio_ticker ON portfolio_holdings(ticker_code);

-- 8. BACKTEST RUNS
CREATE TABLE IF NOT EXISTS backtest_runs (
    id                  BIGSERIAL PRIMARY KEY,
    run_date            TIMESTAMPTZ DEFAULT NOW(),
    config_json         JSONB,
    ticker_count        INTEGER,
    total_trades        INTEGER,
    win_count           INTEGER,
    loss_count          INTEGER,
    win_rate            NUMERIC(6,2),
    avg_r_multiple      NUMERIC(8,4),
    expectancy          NUMERIC(8,4),
    max_drawdown_pct    NUMERIC(8,4),
    summary_json        JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 9. BACKTEST TRADES
CREATE TABLE IF NOT EXISTS backtest_trades (
    id                  BIGSERIAL PRIMARY KEY,
    backtest_run_id     BIGINT REFERENCES backtest_runs(id) ON DELETE CASCADE,
    ticker_code         TEXT NOT NULL,
    entry_date          DATE,
    exit_date           DATE,
    entry_price         NUMERIC(14,4),
    exit_price          NUMERIC(14,4),
    stop_loss           NUMERIC(14,4),
    price_target        NUMERIC(14,4),
    trigger_type        TEXT,
    r_multiple          NUMERIC(8,4),
    pnl_pct             NUMERIC(8,4),
    outcome             TEXT,
    details_json        JSONB
);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades(backtest_run_id);

-- 10. NEWS ANALYSIS CACHE
CREATE TABLE IF NOT EXISTS news_analysis_cache (
    id                  BIGSERIAL PRIMARY KEY,
    ticker_code         TEXT NOT NULL REFERENCES tickers(code),
    analysis_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    sentiment           TEXT,
    sentiment_score     NUMERIC(4,2),
    key_story           TEXT,
    summary             TEXT,
    raw_response_json   JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ticker_code, analysis_date)
);

-- 11. ML PREDICTIONS (daily LSTM price predictions)
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
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ticker_code, prediction_date)
);

CREATE INDEX IF NOT EXISTS idx_predictions_ticker ON predictions(ticker_code, prediction_date DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_date ON predictions(prediction_date DESC);

-- 12. PORTFOLIO SNAPSHOTS (daily portfolio state for equity curve)
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    snapshot_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    total_value         NUMERIC(20,4),
    total_cost          NUMERIC(20,4),
    unrealized_pnl      NUMERIC(20,4),
    realized_pnl        NUMERIC(20,4),
    open_positions      INTEGER,
    sector_exposure     JSONB,
    holdings_json       JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date ON portfolio_snapshots(snapshot_date DESC);

-- 13. TRADE JOURNAL (notes and lessons per trade)
CREATE TABLE IF NOT EXISTS trade_journal (
    id                  BIGSERIAL PRIMARY KEY,
    holding_id          BIGINT REFERENCES portfolio_holdings(id) ON DELETE CASCADE,
    entry_date          TIMESTAMPTZ DEFAULT NOW(),
    note_type           TEXT DEFAULT 'note',
    content             TEXT,
    tags                TEXT[],
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_journal_holding ON trade_journal(holding_id);
CREATE INDEX IF NOT EXISTS idx_trade_journal_date ON trade_journal(entry_date DESC);

-- 14. NEWS ARTICLES (central storage for all news from all sources)
CREATE TABLE IF NOT EXISTS news_articles (
    id              BIGSERIAL PRIMARY KEY,
    source          TEXT NOT NULL,              -- 'kabutan', 'jquants', 'yahoo_rss', 'nikkei', 'minkabu', 'reuters'
    source_url      TEXT,
    title           TEXT NOT NULL,
    title_ja        TEXT,
    body_text       TEXT,
    category        TEXT,
    published_at    TIMESTAMPTZ,
    fetched_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Gemini analysis (NULL until analyzed)
    is_analyzed     BOOLEAN DEFAULT FALSE,
    relevance_score NUMERIC(4,3),               -- 0.000 to 1.000
    impact_level    TEXT,                        -- 'high', 'medium', 'low'
    sentiment       TEXT,                        -- 'Bullish', 'Bearish', 'Neutral'
    sentiment_score NUMERIC(4,2),               -- -1.00 to 1.00
    news_category   TEXT,                        -- 'earnings', 'guidance', 'M&A', 'restructuring', 'macro', 'dividend', 'buyback', 'regulation', 'product', 'other'
    ai_summary      TEXT,
    analysis_json   JSONB,
    analyzed_at     TIMESTAMPTZ,

    -- Deduplication
    content_hash    TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_news_articles_source ON news_articles(source, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_analyzed ON news_articles(is_analyzed, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_published ON news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_sentiment ON news_articles(sentiment, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_articles_impact ON news_articles(impact_level, published_at DESC);

-- 15. NEWS ARTICLE TICKERS (many-to-many: articles mention multiple tickers)
CREATE TABLE IF NOT EXISTS news_article_tickers (
    id              BIGSERIAL PRIMARY KEY,
    article_id      BIGINT NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
    ticker_code     TEXT NOT NULL,
    is_primary      BOOLEAN DEFAULT FALSE,
    UNIQUE(article_id, ticker_code)
);

CREATE INDEX IF NOT EXISTS idx_news_tickers_ticker ON news_article_tickers(ticker_code, article_id DESC);
CREATE INDEX IF NOT EXISTS idx_news_tickers_article ON news_article_tickers(article_id);

-- 16. NEWS WATCHLIST (news-driven watchlist candidates, regenerated periodically)
CREATE TABLE IF NOT EXISTS news_watchlist (
    id              BIGSERIAL PRIMARY KEY,
    ticker_code     TEXT NOT NULL,
    generated_at    TIMESTAMPTZ DEFAULT NOW(),
    composite_score NUMERIC(6,3),
    article_count   INTEGER DEFAULT 0,
    avg_sentiment   NUMERIC(4,2),
    max_impact      TEXT,
    sources_count   INTEGER DEFAULT 0,
    top_reason      TEXT,
    articles_json   JSONB,
    UNIQUE(ticker_code, (generated_at::date))
);

-- 17. DAILY NEWS REPORTS (cached Gemini-generated daily narratives)
CREATE TABLE IF NOT EXISTS daily_news_reports (
    id            BIGSERIAL PRIMARY KEY,
    report_date   DATE NOT NULL,
    article_count INTEGER NOT NULL DEFAULT 0,
    report_json   JSONB NOT NULL,
    generated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(report_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_news_reports_date ON daily_news_reports(report_date DESC);

-- 18. AI REVIEWS (Gemini-powered buy signal validation)
CREATE TABLE IF NOT EXISTS ai_reviews (
    id              BIGSERIAL PRIMARY KEY,
    scan_id         UUID NOT NULL REFERENCES scan_runs(scan_id) ON DELETE CASCADE,
    ticker_code     TEXT NOT NULL REFERENCES tickers(code),
    verdict         TEXT NOT NULL,       -- CONFIRMED | CAUTION | AVOID
    reason          TEXT,
    confidence      SMALLINT,            -- 0-100
    full_analysis   JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(scan_id, ticker_code)
);
CREATE INDEX IF NOT EXISTS idx_ai_reviews_scan ON ai_reviews(scan_id);
CREATE INDEX IF NOT EXISTS idx_ai_reviews_ticker ON ai_reviews(ticker_code, created_at DESC);
