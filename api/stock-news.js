/**
 * =================================================================================
 * Vercel Serverless Function: /api/stock-news
 * =================================================================================
 * This function runs on the server and acts as a secure endpoint for news analysis.
 * It uses the same structure as your working /api/stocks endpoint to ensure compatibility.
 * =================================================================================
 */

// Use CommonJS module exports to match your working example
module.exports = async (req, res) => {
  // --- CORS HEADERS ---
  // Use the exact same CORS logic from your working file
  const allowedOrigins = [
    "https://thegoodmanagers.com",
    "https://www.thegoodmanagers.com",
    "http://localhost:3000", // Added for local development
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle pre-flight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // This is a GET endpoint
  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  const { ticker } = req.query; // e.g., ticker="7203"

  if (!ticker) {
    return res
      .status(400)
      .json({ success: false, error: "Ticker query parameter is required." });
  }

  // Convert the 4-digit ticker to the 5-digit J-Quants code
  const jquantsTicker = `${ticker}0`;

  try {
    const analysis = await getJQuantsNewsAnalysis(jquantsTicker);
    return res.status(200).json(analysis);
  } catch (error) {
    console.error(`[API Error] Failed to analyze news for ${ticker}:`, error);
    return res
      .status(500)
      .json({
        success: false,
        error: "Failed to perform news analysis.",
        details: error.message,
      });
  }
};

// --- All helper functions are now self-contained within this server-side file ---

async function getJQuantsNewsAnalysis(ticker) {
  console.log(`[API] 🚀 Starting news analysis for ticker: ${ticker}`);

  const jquantsEmail = process.env.JQUANTS_EMAIL;
  const jquantsPassword = process.env.JQUANTS_PASSWORD;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!jquantsEmail || !jquantsPassword || !geminiApiKey) {
    console.error(
      "[API Error] ❌ ERROR: JQUANTS_EMAIL, JQUANTS_PASSWORD, and GEMINI_API_KEY environment variables must be set."
    );
    throw new Error("Server configuration error: Missing API credentials.");
  }

  const idToken = await getJQuantsIdToken(jquantsEmail, jquantsPassword);
  if (!idToken) throw new Error("Failed to authenticate with J-Quants.");

  const disclosures = await fetchJQuantsDisclosures(ticker, idToken);
  if (!disclosures || disclosures.length === 0) {
    return {
      sentiment: "Neutral",
      sentiment_score: 0.0,
      key_story: "No recent disclosures found.",
      summary: "No official disclosures in the last 7 days.",
    };
  }

  const analysis = await analyzeDisclosuresWithGemini(
    ticker,
    disclosures,
    geminiApiKey
  );
  console.log(
    `[API] ✅ News analysis for ${ticker} complete: ${analysis.sentiment} (${analysis.sentiment_score})`
  );
  return analysis;
}

async function getJQuantsIdToken(email, password) {
  const refreshResponse = await fetch(
    "https://api.jquants.com/v1/token/auth_user",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailaddress: email, password: password }),
    }
  );
  if (!refreshResponse.ok)
    throw new Error("J-Quants login failed. Check credentials.");
  const { refreshToken } = await refreshResponse.json();

  const idTokenResponse = await fetch(
    `https://api.jquants.com/v1/token/auth_refresh?refreshtoken=${refreshToken}`,
    {
      method: "POST",
    }
  );
  if (!idTokenResponse.ok)
    throw new Error("Failed to get ID Token from refresh token.");
  const { idToken } = await idTokenResponse.json();
  return idToken;
}

async function fetchJQuantsDisclosures(ticker, idToken) {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const fromDate = sevenDaysAgo.toISOString().split("T")[0];
  const toDate = today.toISOString().split("T")[0];
  const url = `https://api.jquants.com/v1/fins/timely_disclosure?code=${ticker}&from=${fromDate}&to=${toDate}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok)
    throw new Error(`J-Quants API error! Status: ${response.status}`);
  const data = await response.json();
  return data.timely_disclosure || [];
}

async function analyzeDisclosuresWithGemini(ticker, disclosures, geminiApiKey) {
  const disclosureText = disclosures
    .map(
      (d) => `- Date: ${d.Date}, Title: "${d.Title}", Type: ${d.TypeCodeName}`
    )
    .join("\n");
  const prompt = `
      As a financial analyst for Japanese stocks, analyze the following official company disclosures (TDnet) for stock code ${ticker}.
      Focus only on these specific, factual announcements.
      Provide your analysis in a JSON object with the following keys:
      - "sentiment": A string, must be one of: 'Bullish', 'Bearish', or 'Neutral'.
      - "sentiment_score": A number between -1.0 (extremely bearish) and 1.0 (extremely bullish).
      - "key_story": A string with the title of the most impactful disclosure.
      - "summary": A one-sentence explanation for your sentiment.
      Disclosures:\n${disclosureText}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          sentiment: {
            type: "STRING",
            enum: ["Bullish", "Bearish", "Neutral"],
          },
          sentiment_score: { type: "NUMBER" },
          key_story: { type: "STRING" },
          summary: { type: "STRING" },
        },
        required: ["sentiment", "sentiment_score", "key_story", "summary"],
      },
    },
  };
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok)
    throw new Error(`Gemini API error! Status: ${response.status}`);
  const result = await response.json();
  if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
    return JSON.parse(result.candidates[0].content.parts[0].text);
  } else {
    throw new Error("Invalid response structure from Gemini API.");
  }
}
