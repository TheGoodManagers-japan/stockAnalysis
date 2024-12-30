const axios = require("axios");
const cheerio = require("cheerio");

async function fetchNewsLinks(ticker, totalPages = 3) {
  const baseUrl = `https://finance.yahoo.co.jp/quote/${ticker}/news`;
  const newsLinks = [];

  for (let page = 1; page <= totalPages; page++) {
    try {
      const url = `${baseUrl}?page=${page}`;
      console.log(`Fetching news list from: ${url}`);
      const { data: html } = await axios.get(url);
      const $ = cheerio.load(html);

      // Extract article links and titles from the news list
      $("#newslist a.NewsItem__link__KiSQ").each((i, el) => {
        const href = $(el).attr("href");
        const title = $(el).find("h3.NewsItem__heading__qWJ8").text().trim();
        if (href && href.startsWith("https") && title) {
          newsLinks.push({ ticker, url: href, title });
        }
      });
    } catch (error) {
      console.error(
        `Error fetching news links from page ${page}:`,
        error.message
      );
    }
  }

  console.log(`Total links fetched for ${ticker}: ${newsLinks.length}`);
  return newsLinks;
}

async function fetchArticleContent(url) {
  try {
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    // Extract plain text from <div class="textArea__3DuB">
    const contentDiv = $(".textArea__3DuB");

    if (!contentDiv.length) {
      console.warn(`No content found in the specified div for URL: ${url}`);
      return null;
    }

    // Get all paragraphs and clean them up
    const paragraphs = contentDiv
      .find("p")
      .map((i, el) => $(el).text().trim())
      .get();
    const articleText = paragraphs.join("\n\n");

    return articleText || null;
  } catch (error) {
    console.error(`Error fetching article content from ${url}:`, error.message);
    return null;
  }
}

async function analyzeSentiment(content, openaiApiKey) {
  const url = "https://api.openai.com/v1/chat/completions";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${openaiApiKey}`,
  };

  const messages = [
    {
      role: "system",
      content: `You are a sentiment analysis assistant. Analyze the sentiment of the following text and provide a sentiment score between 0 (very negative) and 1 (very positive). Respond with only the score.`,
    },
    {
      role: "user",
      content: `Analyze this text for sentiment: \n\n${content}`,
    },
  ];

  const payload = {
    model: "gpt-4o-mini",
    messages,
    max_tokens: 100,
  };

  try {
    const response = await axios.post(url, payload, { headers });
    const sentimentScore = parseFloat(
      response.data.choices[0].message.content.trim()
    );
    return sentimentScore;
  } catch (error) {
    console.error("Error during sentiment analysis:", error.message);
    return null;
  }
}

async function scrapeYahooFinanceNews(ticker, openaiApiKey) {
  const totalPages = 3;
  const allArticles = [];

  // Fetch news links from all pages
  const newsLinks = await fetchNewsLinks(ticker, totalPages);

  // Visit each link and scrape the article content
  for (const [index, { ticker, url, title }] of newsLinks.entries()) {
    console.log(`Fetching article ${index + 1}/${newsLinks.length}: ${url}`);
    const content = await fetchArticleContent(url);
    if (content) {
      const sentimentScore = await analyzeSentiment(content, openaiApiKey);
      allArticles.push({ ticker, url, title, content, sentimentScore });
    }
  }

  console.log(`\nTotal articles scraped for ${ticker}: ${allArticles.length}`);
  return allArticles;
}

// API handler
const allowedOrigins = [
  "https://thegoodmanagers.com",
  "https://www.thegoodmanagers.com",
];

module.exports = async (req, res) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Handle preflight requests
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method Not Allowed. Use POST for this endpoint.",
    });
  }

  try {
    // Ensure the server parses JSON bodies (add express.json() or equivalent middleware)
    const { ticker, openaiApiKey } = req.body;

    // Validate required parameters
    if (!ticker || !openaiApiKey) {
      return res.status(400).json({
        success: false,
        message: "Ticker and OpenAI API key are required.",
      });
    }

    // Call your scraping function
    const sentimentData = await scrapeYahooFinanceNews(ticker, openaiApiKey);

    res.status(200).json({ success: true, data: sentimentData });
  } catch (error) {
    console.error("Error in API handler:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};
