// dashboard/engine/scoring/catalystScore.js
// Catalyst score (0-10) combining news sentiment + J-Quants disclosure events.
// Pure function — takes pre-loaded data, no DB calls.

/**
 * Compute catalyst score from news stats and disclosure data.
 *
 * @param {Object|null} newsStats - { article_count, avg_sentiment, max_impact, sources_count }
 * @param {Array|null} disclosures - [{ news_category, sentiment_score }]
 * @returns {{ score: number, components: object, reason: string }}
 */
export function computeCatalystScore(newsStats, disclosures) {
  const components = {
    newsSentiment: 0,
    newsImpact: 0,
    newsConfirmation: 0,
    disclosureBoost: 0,
    articleCount: 0,
  };

  let hasData = false;

  // --- News sentiment component (0-6 points) ---
  if (newsStats && newsStats.article_count > 0) {
    hasData = true;
    const avgSent = Number(newsStats.avg_sentiment) || 0;
    const maxImpact = Number(newsStats.max_impact) || 1;
    const sourcesCt = Number(newsStats.sources_count) || 1;

    // Sentiment: -1 to +1 → 0 to 3
    components.newsSentiment =
      Math.round(((avgSent + 1) / 2) * 3 * 100) / 100;

    // Impact level: high(3) med(2) low(1) → 0 to 2
    components.newsImpact = Math.round((maxImpact / 3) * 2 * 100) / 100;

    // Multi-source confirmation: 0 to 1
    components.newsConfirmation = Math.min(sourcesCt / 3, 1);

    components.articleCount = Number(newsStats.article_count);
  }

  // --- J-Quants disclosure component (clamped 0-4 points) ---
  let disclosureRaw = 0;
  const disclosureReasons = [];

  if (disclosures && disclosures.length > 0) {
    hasData = true;
    for (const d of disclosures) {
      const cat = (d.news_category || "").toLowerCase();
      const sent = Number(d.sentiment_score) || 0;

      if (cat === "earnings") {
        if (sent > 0) {
          disclosureRaw += 2;
          disclosureReasons.push("positive earnings");
        } else if (sent < 0) {
          disclosureRaw -= 2;
          disclosureReasons.push("negative earnings");
        }
      } else if (cat === "buyback") {
        disclosureRaw += 1.5;
        disclosureReasons.push("buyback");
      } else if (cat === "dividend") {
        if (sent >= 0) {
          disclosureRaw += 1;
          disclosureReasons.push("dividend increase");
        } else {
          disclosureRaw -= 1;
          disclosureReasons.push("dividend cut");
        }
      } else if (cat === "guidance") {
        if (sent < 0) {
          disclosureRaw -= 1.5;
          disclosureReasons.push("negative guidance");
        } else if (sent > 0) {
          disclosureRaw += 1;
          disclosureReasons.push("positive guidance");
        }
      } else if (cat === "m&a" || cat === "restructuring") {
        disclosureRaw += sent > 0 ? 1 : -0.5;
        disclosureReasons.push(cat);
      }
    }
  }

  components.disclosureBoost = Math.max(0, Math.min(4, disclosureRaw + 2)); // shift so 0 baseline → 2, clamp 0-4

  if (!hasData) {
    return {
      score: 5.0,
      components,
      reason: "No recent catalyst news",
    };
  }

  // Total: news (0-6) + disclosure (0-4) = 0-10
  const raw =
    components.newsSentiment +
    components.newsImpact +
    components.newsConfirmation +
    components.disclosureBoost;

  const score = Math.max(0, Math.min(10, Math.round(raw * 10) / 10));

  // Build reason string
  const parts = [];
  if (components.articleCount > 0) {
    const sentLabel =
      components.newsSentiment > 1.8
        ? "bullish"
        : components.newsSentiment < 1.2
          ? "bearish"
          : "neutral";
    parts.push(
      `${components.articleCount} articles (${sentLabel} sentiment)`
    );
  }
  if (disclosureReasons.length > 0) {
    parts.push(disclosureReasons.join(", "));
  }
  const reason = parts.join(" + ") || "Weak catalyst data";

  return { score, components, reason };
}
