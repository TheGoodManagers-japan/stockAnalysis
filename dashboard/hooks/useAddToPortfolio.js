"use client";

import { useState, useEffect, useRef, useCallback } from "react";

function deriveEntryKind(reason) {
  if (!reason) return "OTHER";
  const r = reason.toLowerCase();
  if (r.includes("dip")) return "DIP";
  if (r.includes("breakout")) return "BREAKOUT";
  if (r.includes("retest")) return "RETEST";
  return "OTHER";
}

/**
 * Manages add-to-portfolio popup state, form data, submission, and outside-click dismissal.
 * @returns All state + handlers for the add-to-portfolio flow.
 */
export function useAddToPortfolio() {
  const [addingTicker, setAddingTicker] = useState(null);
  const [addForm, setAddForm] = useState({});
  const [addStatus, setAddStatus] = useState(null);
  const [addedTickers, setAddedTickers] = useState(new Set());
  const popupRef = useRef(null);

  // Close popup on outside click
  useEffect(() => {
    if (!addingTicker) return;
    function handleClick(e) {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setAddingTicker(null);
        setAddStatus(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [addingTicker]);

  const openAddPopup = useCallback((r) => {
    setAddingTicker(r.ticker_code);
    setAddForm({
      ticker_code: r.ticker_code,
      entry_price: r.current_price || "",
      shares: "100",
      initial_stop: r.stop_loss || "",
      price_target: r.price_target || "",
      entry_kind: deriveEntryKind(r.buy_now_reason),
      entry_reason: r.buy_now_reason || "",
      entry_date: new Date().toISOString().split("T")[0],
    });
    setAddStatus(null);
  }, []);

  const handleAddToPortfolio = useCallback(async (e) => {
    e.preventDefault();
    setAddStatus("loading");
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker_code: addForm.ticker_code,
          entry_price: Number(addForm.entry_price),
          shares: Number(addForm.shares),
          initial_stop: addForm.initial_stop ? Number(addForm.initial_stop) : null,
          price_target: addForm.price_target ? Number(addForm.price_target) : null,
          entry_kind: addForm.entry_kind,
          entry_reason: addForm.entry_reason,
          entry_date: addForm.entry_date,
        }),
      });
      if (res.ok) {
        setAddStatus("success");
        setAddedTickers((prev) => new Set(prev).add(addForm.ticker_code));
        setTimeout(() => {
          setAddingTicker(null);
          setAddStatus(null);
        }, 1200);
      } else {
        setAddStatus("error");
      }
    } catch {
      setAddStatus("error");
    }
  }, [addForm]);

  const closePopup = useCallback(() => {
    setAddingTicker(null);
    setAddStatus(null);
  }, []);

  return {
    addingTicker,
    addForm,
    setAddForm,
    addStatus,
    addedTickers,
    popupRef,
    openAddPopup,
    handleAddToPortfolio,
    closePopup,
  };
}
