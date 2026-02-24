"use client";
import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Generic data fetching hook with loading/error state.
 * @param {string|null} url - API endpoint (null to skip)
 * @param {object} [options]
 * @param {boolean} [options.immediate=true] - Fetch on mount
 * @param {any} [options.initialData=null] - Initial data value
 * @param {Function} [options.transform] - Transform response JSON before setting
 * @param {Array} [options.deps=[]] - Additional dependencies for refetch
 * @returns {{ data, loading, error, refetch, setData }}
 */
export function useFetch(url, options = {}) {
  const {
    immediate = true,
    initialData = null,
    transform,
    deps = [],
  } = options;

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const refetch = useCallback(async () => {
    if (!url) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const json = await res.json();
      if (!controller.signal.aborted) {
        setData(transform ? transform(json) : json);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [url, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (immediate && url) refetch();
    return () => abortRef.current?.abort();
  }, [refetch, immediate, url]);

  return { data, loading, error, refetch, setData };
}
