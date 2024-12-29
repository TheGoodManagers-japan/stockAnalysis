const yahooFinance = require("yahoo-finance2").default;

module.exports = async (req, res) => {
  const { ticker } = req.query;

  if (!ticker) {
    res.status(400).json({ error: "Ticker symbol is required" });
    return;
  }

  try {
    console.log(`Fetching historical data for ${ticker}...`);

    // Fetch historical data (12 months)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const period1 = Math.floor(oneYearAgo.getTime() / 1000);

    const historicalData = await yahooFinance.chart(ticker, {
      period1,
      interval: "1d",
    });

    if (
      !historicalData ||
      !historicalData.quotes ||
      historicalData.quotes.length === 0
    ) {
      res
        .status(404)
        .json({ error: `No historical data available for ${ticker}` });
      return;
    }

    console.log(`Fetched historical data for ${ticker}.`);

    // Prepare the response
    const data = historicalData.quotes.map((quote) => ({
      price: quote.close,
      volume: quote.volume,
      date: quote.date, // Use raw date string for frontend to parse
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error(`Error fetching data for ticker ${ticker}:`, error.message);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
};
