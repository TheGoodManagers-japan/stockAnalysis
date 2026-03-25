// Seasonal bias computation — identifies active and upcoming seasonal patterns.

import { SEASONAL_PATTERNS, CENTRAL_BANK_MEETINGS } from "../../data/seasonalCalendar.js";

/**
 * Check if a date falls within a seasonal pattern's window.
 */
function isDateInPattern(date, pattern) {
  const month = date.getMonth() + 1; // 1-12
  const day = date.getDate();

  const { startMonth, startDay = 1, endMonth, endDay = 31 } = pattern;

  // Handle year-wrapping patterns (e.g., Dec 20 → Jan 3)
  if (startMonth > endMonth) {
    // Date is in Dec portion or Jan portion
    if (month > startMonth || (month === startMonth && day >= startDay)) return true;
    if (month < endMonth || (month === endMonth && day <= endDay)) return true;
    return false;
  }

  // Same month
  if (startMonth === endMonth) {
    return month === startMonth && day >= startDay && day <= endDay;
  }

  // Normal range
  if (month > startMonth && month < endMonth) return true;
  if (month === startMonth && day >= startDay) return true;
  if (month === endMonth && day <= endDay) return true;
  return false;
}

/**
 * Check if a pattern starts within the next N days.
 */
function startsWithinDays(date, pattern, days) {
  const futureDate = new Date(date);
  futureDate.setDate(futureDate.getDate() + days);

  for (let d = new Date(date); d <= futureDate; d.setDate(d.getDate() + 1)) {
    const m = d.getMonth() + 1;
    const day = d.getDate();
    if (m === pattern.startMonth && day === (pattern.startDay || 1)) return true;
  }
  return false;
}

/**
 * Compute seasonal bias for a given date.
 *
 * @param {Date|string} dateInput
 * @returns {{ activeEvents: Array, upcomingEvents: Array, upcomingMeetings: Array, overallBias: string }}
 */
export function computeSeasonalBias(dateInput) {
  const date = new Date(dateInput);
  const activeEvents = [];
  const upcomingEvents = [];

  for (const pattern of SEASONAL_PATTERNS) {
    if (isDateInPattern(date, pattern)) {
      activeEvents.push(pattern);
    } else if (startsWithinDays(date, pattern, 14)) {
      upcomingEvents.push(pattern);
    }
  }

  // Find central bank meetings within 7 days
  const dateISO = date.toISOString().slice(0, 10);
  const futureISO = new Date(date.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const upcomingMeetings = CENTRAL_BANK_MEETINGS.filter(
    (m) => m.date >= dateISO && m.date <= futureISO
  );

  // Compute overall bias from active events
  let bullishCount = 0;
  let bearishCount = 0;
  let volatileCount = 0;
  for (const e of activeEvents) {
    if (e.bias === "bullish") bullishCount++;
    else if (e.bias === "bearish") bearishCount++;
    else if (e.bias === "volatile") volatileCount++;
    else if (e.bias === "cautious") bearishCount += 0.5;
  }

  let overallBias = "neutral";
  if (bullishCount > bearishCount && bullishCount > volatileCount) overallBias = "bullish";
  else if (bearishCount > bullishCount) overallBias = "bearish";
  else if (volatileCount > 0) overallBias = "volatile";
  else if (activeEvents.length > 0) overallBias = "mixed";

  return { activeEvents, upcomingEvents, upcomingMeetings, overallBias };
}
