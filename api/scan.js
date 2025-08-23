// api/scan.js  (CommonJS-compatible, ESM-friendly dynamic import)
const path = require("path");

async function readJsonBody(req) {
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

module.exports = async (req, res) => {
  try {
    // CORS (optional)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (!["GET", "POST"].includes(req.method)) {
      return res
        .status(405)
        .json({ success: false, error: "Method Not Allowed" });
    }

    // ✅ Correct path to your file: /public/script/main.js
    const abs = path.join(process.cwd(), "public", "script", "main.js");
    const mod = await import("file://" + abs); // works with ESM main.js
    const { fetchStockAnalysis } = mod;

    let tickers = [];
    let portfolio = [];
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      tickers = Array.isArray(body.tickers) ? body.tickers : [];
      portfolio = Array.isArray(body.portfolio) ? body.portfolio : [];
    } else if (req.method === "GET") {
      tickers = String(req.query?.tickers || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const results = [];
    const out = await fetchStockAnalysis({
      tickers,
      myPortfolio: portfolio,
      onItem: (item) => results.push(item),
    });

    return res.status(200).json({ success: true, ...out, results });
  } catch (err) {
    console.error("scan endpoint error:", err);
    return res
      .status(500)
      .json({ success: false, error: String(err?.message || err) });
  }
};
