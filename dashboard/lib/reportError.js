/**
 * Report an error to the centralized error log.
 * Fire-and-forget — never throws. Works from client components.
 *
 * @param {string} source - Where the error occurred (e.g., "component/ScannerTable")
 * @param {string|Error} messageOrError - Error message string or Error object
 * @param {object} [details] - Extra context (ticker, URL, etc.)
 */
export function reportError(source, messageOrError, details = null) {
  const isErr = messageOrError instanceof Error;
  const message = isErr ? messageOrError.message : String(messageOrError);
  const stack = isErr ? messageOrError.stack : undefined;

  console.error(`[${source}]`, message);

  fetch("/api/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source,
      message,
      severity: "error",
      stack: stack || null,
      details,
    }),
  }).catch(() => {});
}
