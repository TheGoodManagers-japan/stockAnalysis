// Batch-fetch all recent TDnet disclosures from J-Quants (not per-ticker)
// Reuses the same auth pattern as dashboard/app/api/stock-news/route.js

async function getIdToken() {
  const email = process.env.JQUANTS_EMAIL;
  const password = process.env.JQUANTS_PASSWORD;
  if (!email || !password) throw new Error("JQUANTS_EMAIL / JQUANTS_PASSWORD not set");

  const refreshRes = await fetch("https://api.jquants.com/v1/token/auth_user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mailaddress: email, password }),
  });
  if (!refreshRes.ok) throw new Error(`J-Quants login failed: ${refreshRes.status}`);
  const { refreshToken } = await refreshRes.json();

  const idRes = await fetch(
    `https://api.jquants.com/v1/token/auth_refresh?refreshtoken=${refreshToken}`,
    { method: "POST" }
  );
  if (!idRes.ok) throw new Error(`J-Quants refresh failed: ${idRes.status}`);
  const { idToken } = await idRes.json();
  return idToken;
}

export async function fetchArticles({ daysBack = 3 } = {}) {
  const idToken = await getIdToken();

  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - daysBack);
  const fromDate = from.toISOString().split("T")[0];
  const toDate = today.toISOString().split("T")[0];

  // Fetch ALL disclosures for the date range (no ticker filter)
  const url = `https://api.jquants.com/v1/fins/timely_disclosure?from=${fromDate}&to=${toDate}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`J-Quants API error: ${res.status}`);

  const data = await res.json();
  const disclosures = data.timely_disclosure || [];

  return disclosures.map(d => {
    // J-Quants uses 5-digit codes (72030), strip trailing 0 for our ####.T format
    const rawCode = String(d.Code || "");
    const tickerCode = rawCode.length === 5
      ? `${rawCode.slice(0, 4)}.T`
      : `${rawCode}.T`;

    return {
      source: "jquants",
      source_url: d.PDFURLs?.[0] || `https://api.jquants.com/disclosure/${d.DisclosureNumber || ""}`,
      title: d.Title || "Untitled disclosure",
      title_ja: d.Title || null,
      body_text: [
        d.TypeCodeName && `Type: ${d.TypeCodeName}`,
        d.CompanyName && `Company: ${d.CompanyName}`,
        d.Title,
      ].filter(Boolean).join(" | ").slice(0, 4000),
      category: d.TypeCodeName || "disclosure",
      published_at: d.Date ? new Date(d.Date).toISOString() : null,
      tickers: [tickerCode],
    };
  });
}
