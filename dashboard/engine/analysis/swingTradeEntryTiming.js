// swingTradeEntryTiming.js — thin proxy, delegates to entry/ modules
// All logic now lives in entry/{entryConfig, tapeReading, rrAnalysis, guardVeto, entryHelpers, index}.js

export {
  analyzeDipEntry,
  getConfig,
  summarizeBlocks,
  summarizeTelemetryForLog,
  goldenCross25Over75BarsAgo,
  dailyFlipBarsAgo,
} from "./entry/index.js";
