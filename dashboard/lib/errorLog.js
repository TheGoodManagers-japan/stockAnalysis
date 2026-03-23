import { query } from "./db.js";

/**
 * Log an error to the error_log table.
 * @param {string} source - Where the error originated (e.g., "api/scan", "component/Header")
 * @param {string} message - Human-readable error message
 * @param {object} [options]
 * @param {"error"|"warning"|"critical"} [options.severity]
 * @param {string} [options.stack] - Stack trace
 * @param {object} [options.details] - Arbitrary context (ticker, scanId, etc.)
 */
export async function logError(source, message, options = {}) {
  const { severity = "error", stack = null, details = null } = options;
  try {
    await query(
      `INSERT INTO error_log (severity, source, message, stack, details_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [severity, source, message, stack, details ? JSON.stringify(details) : null]
    );
  } catch (dbErr) {
    console.error("[errorLog] Failed to persist error:", dbErr.message);
    console.error("[errorLog] Original error:", source, message);
  }
}

/**
 * Convenience: log from a caught Error object.
 */
export async function logErrorFromCatch(source, err, details = null) {
  await logError(source, err?.message || String(err), {
    severity: "error",
    stack: err?.stack || null,
    details,
  });
}
