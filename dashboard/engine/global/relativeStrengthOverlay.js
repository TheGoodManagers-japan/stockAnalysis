// Relative Strength Overlay — compares JP sectors against US equivalents.
// Uses sector_rotation_snapshots data from both markets.

import { SECTOR_PAIRS } from "../../data/globalTickers.js";

/**
 * Compare JP and US sector snapshots to find cross-market relative strength.
 *
 * @param {Array<{sector_id: string, composite_score: number, rs_5: number, rs_10: number, rs_20: number, recommendation: string}>} jpSectors
 * @param {Array<{sector_id: string, composite_score: number, rs_5: number, rs_10: number, rs_20: number, recommendation: string}>} usSectors
 * @returns {{ pairs: Array, jpLeads: Array, usLeads: Array, bothStrong: Array, divergences: Array }}
 */
export function computeRelativeStrengthOverlay(jpSectors, usSectors) {
  if (!jpSectors?.length || !usSectors?.length) {
    return { pairs: [], jpLeads: [], usLeads: [], bothStrong: [], divergences: [] };
  }

  const jpByID = new Map(jpSectors.map((s) => [s.sector_id, s]));
  const usByID = new Map(usSectors.map((s) => [s.sector_id, s]));

  const pairs = [];
  const jpLeads = [];
  const usLeads = [];
  const bothStrong = [];
  const divergences = [];

  for (const [jpSectorId, usSectorId] of Object.entries(SECTOR_PAIRS)) {
    const jp = jpByID.get(jpSectorId);
    const us = usByID.get(usSectorId);
    if (!jp || !us) continue;

    const jpScore = Number(jp.composite_score) || 0;
    const usScore = Number(us.composite_score) || 0;
    const diff = jpScore - usScore;

    const pair = {
      jpSector: jpSectorId,
      usSector: usSectorId,
      jpSectorLabel: formatSector(jpSectorId),
      usSectorLabel: formatSector(usSectorId),
      jpScore: +jpScore.toFixed(1),
      usScore: +usScore.toFixed(1),
      diff: +diff.toFixed(1),
      jpRecommendation: jp.recommendation,
      usRecommendation: us.recommendation,
      jpRs10: Number(jp.rs_10) || 0,
      usRs10: Number(us.rs_10) || 0,
    };

    pairs.push(pair);

    const jpStrong = jpScore >= 60;
    const usStrong = usScore >= 60;
    const jpWeak = jpScore <= 40;
    const usWeak = usScore <= 40;

    if (jpStrong && usStrong) {
      pair.category = "both_strong";
      bothStrong.push(pair);
    } else if (jpStrong && usWeak) {
      pair.category = "jp_leads";
      jpLeads.push(pair);
    } else if (usStrong && jpWeak) {
      pair.category = "us_leads";
      usLeads.push(pair);
    } else if ((jpStrong && !usStrong) || (!jpStrong && usStrong)) {
      pair.category = "divergence";
      divergences.push(pair);
    } else if (Math.abs(diff) > 15) {
      pair.category = diff > 0 ? "jp_leads" : "us_leads";
      (diff > 0 ? jpLeads : usLeads).push(pair);
    } else {
      pair.category = "neutral";
    }
  }

  // Sort by absolute difference
  pairs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return { pairs, jpLeads, usLeads, bothStrong, divergences };
}

function formatSector(s) {
  if (!s) return "-";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
