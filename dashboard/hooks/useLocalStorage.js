"use client";
import { useState, useCallback } from "react";

/**
 * Persist state to localStorage with SSR safety.
 * @param {string} key - localStorage key
 * @param {any} initialValue - fallback when no stored value
 * @returns {[value, setValue]}
 */
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const val = typeof next === "function" ? next(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(val));
        } catch {}
        return val;
      });
    },
    [key]
  );

  return [value, set];
}
