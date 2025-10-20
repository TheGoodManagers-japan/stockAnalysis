// /api/scan.js
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

async function readJsonBody(req) {
  // If a platform (e.g., Vercel) already parsed JSON, use it
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

const allowedOrigins = [
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
  // add your Bubble preview origin here if you call from editor
  // "https://app.bubble.io"
];

module.exports = async (req, res) => {
  // CORS (align with /api/stocks)
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (!["GET", "POST"].includes(req.method)) {
    return res
      .status(405)
      .json({ success: false, error: "Method Not Allowed" });
  }

  try {
    // 👉 minimal shim so importing main.js never throws on server
    const g = globalThis;
    if (typeof g.window === "undefined") g.window = {};

    const abs = path.join(process.cwd(), "public", "scripts", "main.js");
    if (!fs.existsSync(abs))
      throw new Error(`Shared module not found at ${abs}`);

    // Node will cache this import after the first cold start
    const mod = await import(pathToFileURL(abs).href);
    const { fetchStockAnalysis } = mod;

    let tickers = [];
    let portfolio = [];

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      tickers = Array.isArray(body.tickers) ? body.tickers : [];
      portfolio = Array.isArray(body.portfolio) ? body.portfolio : [];
    } else {
      tickers = String(req.query?.tickers || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // optional: support portfolio via GET if you ever pass it
      // portfolio = JSON.parse(req.query?.portfolio || "[]");
    }

    const results = [];
    const out = await fetchStockAnalysis({
      tickers,
      myPortfolio: portfolio,
      onItem: (item) => {
        console.log(
          `Stock: ${item._api_c2_ticker}, BuyNow: ${item._api_c2_isBuyNow}, StopLoss: ${item._api_c2_stopLoss}, Target: ${item._api_c2_targetPrice}`
        );
        results.push(item);
      },
    });

    return res.status(200).json({ success: true, ...out, results });
  } catch (err) {
    console.error("scan endpoint error:", err);
    return res
      .status(500)
      .json({ success: false, error: String(err?.message || err) });
  }
};
