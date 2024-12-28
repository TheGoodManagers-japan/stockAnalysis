const axios = require("axios");

module.exports = async (req, res) => {
  const { ticker } = req.query;

  if (!ticker) {
    return res.status(400).json({ error: "Ticker is required" });
  }

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}.T`;

  try {
    const response = await axios.get(url);
    res.status(200).json(response.data);
  } catch (error) {
    console.error("Error fetching Yahoo Finance data:", error.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
};
