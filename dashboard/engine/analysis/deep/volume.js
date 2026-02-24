// ================== Volume Profile Analysis ==================
import { num as n } from "../../helpers.js";

/**
 * Builds a volume profile from recent bars — POC direction, HVN/LVN, volume trend.
 */
export function analyzeVolumeProfile(data) {
  const profile = {
    pocRising: false,
    pocFalling: false,
    highVolumeNode: null,
    lowVolumeNode: null,
    volumeTrend: "NEUTRAL",
  };
  if (!data || data.length < 30) return profile;

  const last30 = data.slice(-30);
  const avgPrice =
    last30.reduce((s, d) => s + (n(d.high) + n(d.low)) / 2, 0) / 30;
  const priceStepPercent = 0.005;
  const priceStep = Math.max(1e-8, Math.abs(avgPrice) * priceStepPercent);

  const priceVolumes = {};
  last30.forEach((bar) => {
    const mid = (n(bar.high) + n(bar.low)) / 2;
    const bucket = Math.round(mid / priceStep) * priceStep;
    priceVolumes[bucket] = (priceVolumes[bucket] || 0) + n(bar.volume);
  });

  let maxVolume = -1,
    minVolume = Number.POSITIVE_INFINITY;
  let poc = null,
    lvn = null;

  Object.entries(priceVolumes).forEach(([price, vol]) => {
    const p = parseFloat(price);
    if (vol > maxVolume) {
      maxVolume = vol;
      poc = p;
    }
    if (vol > 0 && vol < minVolume) {
      minVolume = vol;
      lvn = p;
    }
  });

  const recentPrices = last30.slice(-10).map((d) => n(d.close));
  const avgRecentPrice =
    recentPrices.reduce((a, b) => a + b, 0) / Math.max(1, recentPrices.length);

  if (poc != null) {
    profile.pocRising = poc < avgRecentPrice;
    profile.pocFalling = poc > avgRecentPrice;
  }
  profile.highVolumeNode = poc;
  profile.lowVolumeNode = lvn;

  const vol10 = last30.slice(-10).reduce((s, d) => s + n(d.volume), 0) / 10;
  const vol30 = last30.reduce((s, d) => s + n(d.volume), 0) / 30;
  if (vol10 > vol30 * 1.2) profile.volumeTrend = "INCREASING";
  else if (vol10 < vol30 * 0.8) profile.volumeTrend = "DECREASING";

  return profile;
}
