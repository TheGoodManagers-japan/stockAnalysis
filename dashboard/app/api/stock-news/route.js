import { NextResponse } from "next/server";
import { query } from "../../../lib/db.js";

// GET /api/stock-news?ticker=7203
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.trim();

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: "Ticker query parameter is required." },
      { status: 400 }
    );
  }

  // Check cache first
  try {
    const cached = await query(
      `SELECT sentiment, sentiment_score, key_story, summary
       FROM news_analysis_cache
       WHERE ticker_code = $1 AND analysis_date = CURRENT_DATE`,
      [ticker.includes(".") ? ticker : `${ticker}.T`]
    );
    if (cached.rows.length > 0) {
      return NextResponse.json({ success: true, ...cached.rows[0] });
    }
  } catch {
    // Cache miss or DB error, proceed to fetch
  }

  // Convert 4-digit ticker to 5-digit J-Quants code
  const rawTicker = ticker.replace(/\.T$/, "");
  const jquantsTicker = `${rawTicker}0`;

  try {
    const analysis = await getJQuantsNewsAnalysis(jquantsTicker);

    // Cache result
    const tickerCode = ticker.includes(".") ? ticker : `${ticker}.T`;
    try {
      await query(
        `INSERT INTO news_analysis_cache (ticker_code, sentiment, sentiment_score, key_story, summary, raw_response_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (ticker_code, analysis_date) DO UPDATE SET
           sentiment = EXCLUDED.sentiment,
           sentiment_score = EXCLUDED.sentiment_score,
           key_story = EXCLUDED.key_story,
           summary = EXCLUDED.summary,
           raw_response_json = EXCLUDED.raw_response_json`,
        [
          tickerCode,
          analysis.sentiment,
          analysis.sentiment_score,
          analysis.key_story,
          analysis.summary,
          JSON.stringify(analysis),
        ]
      );
    } catch {
      // Non-critical cache failure
    }

    return NextResponse.json({ success: true, ...analysis });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to perform news analysis.", details: error.message },
      { status: 500 }
    );
  }
}

async function getJQuantsNewsAnalysis(ticker) {
  const jquantsEmail = process.env.JQUANTS_EMAIL;
  const jquantsPassword = process.env.JQUANTS_PASSWORD;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!jquantsEmail || !jquantsPassword || !geminiApiKey) {
    throw new Error("Missing API credentials (JQUANTS_EMAIL, JQUANTS_PASSWORD, GEMINI_API_KEY).");
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

  return analyzeDisclosuresWithGemini(ticker, disclosures, geminiApiKey);
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
  if (!refreshResponse.ok) throw new Error("J-Quants login failed.");
  const { refreshToken } = await refreshResponse.json();

  const idTokenResponse = await fetch(
    `https://api.jquants.com/v1/token/auth_refresh?refreshtoken=${refreshToken}`,
    { method: "POST" }
  );
  if (!idTokenResponse.ok) throw new Error("Failed to get ID Token.");
  const { idToken } = await idTokenResponse.json();
  return idToken;
}

async function fetchJQuantsDisclosures(ticker, idToken) {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  const fromDate = sevenDaysAgo.toISOString().split("T")[0];
  const toDate = today.toISOString().split("T")[0];

  const response = await fetch(
    `https://api.jquants.com/v1/fins/timely_disclosure?code=${ticker}&from=${fromDate}&to=${toDate}`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );
  if (!response.ok) throw new Error(`J-Quants API error: ${response.status}`);
  const data = await response.json();
  return data.timely_disclosure || [];
}

async function analyzeDisclosuresWithGemini(ticker, disclosures, geminiApiKey) {
  const disclosureText = disclosures
    .map((d) => `- Date: ${d.Date}, Title: "${d.Title}", Type: ${d.TypeCodeName}`)
    .join("\n");

  const prompt = `As a financial analyst for Japanese stocks, analyze the following official company disclosures (TDnet) for stock code ${ticker}.
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
          sentiment: { type: "STRING", enum: ["Bullish", "Bearish", "Neutral"] },
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

  if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
  const result = await response.json();

  if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
    return JSON.parse(result.candidates[0].content.parts[0].text);
  }
  throw new Error("Invalid response from Gemini API.");
}
