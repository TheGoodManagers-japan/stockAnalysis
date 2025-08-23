// api/run-scan.js (ESM, Vercel)
import { fetchStockAnalysis } from "../main.js"; // path from /api to your main.js

export default async function handler(req, res) {
  // CORS (optional if calling from another origin)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ success: false, error: "Method Not Allowed" });
  }

  try {
    const { tickers = [], portfolio = [] } = req.body ?? {};
    const results = [];

    const { count, errors } = await fetchStockAnalysis({
      tickers, // e.g. ["7203","6758"] (no ".T" needed)
      myPortfolio: portfolio, // e.g. [{ ticker:"7203.T", trade:{ entryPrice, stopLoss, priceTarget } }]
      onItem: (item) => results.push(item),
    });

    return res.status(200).json({
      success: true,
      processed: count,
      results,
      errors, // non-fatal per-ticker errors are collected here
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
