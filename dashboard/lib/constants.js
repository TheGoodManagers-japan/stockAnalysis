// Centralized constants — avoids magic numbers scattered across files

// Scan configuration
export const SCAN_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const STALE_SCAN_MINUTES = 45;

// Market / regime defaults
export const DEFAULT_REGIME_TICKER = "1306.T"; // TOPIX ETF

// AI review
export const GEMINI_MODEL = "gemini-2.0-flash"; // legacy, kept for reference
export const AI_REVIEW_MODEL = "claude-sonnet-4-6-20250514";
export const AI_REVIEW_BATCH_SIZE = 2;
export const AI_REVIEW_BATCH_DELAY_MS = 1000;
