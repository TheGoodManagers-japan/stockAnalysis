// Proxy — re-exports from cache/ subdirectory for backward compatibility
export { getCachedHistory } from "./cache/priceHistory.js";
export { cacheStockSnapshot } from "./cache/snapshots.js";
export { saveScanResult, updatePercentiles } from "./cache/scanResults.js";
