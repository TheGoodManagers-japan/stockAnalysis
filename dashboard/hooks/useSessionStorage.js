"use client";
import { useState, useCallback } from "react";

/**
 * Persist state to sessionStorage (survives navigation within a tab, cleared on tab close).
 * @param {string} key - sessionStorage key
 * @param {any} initialValue - fallback when no stored value
 * @returns {[value, setValue]}
 */
export function useSessionStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const stored = sessionStorage.getItem(key);
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
          sessionStorage.setItem(key, JSON.stringify(val));
        } catch {}
        return val;
      });
    },
    [key]
  );

  return [value, set];
}
