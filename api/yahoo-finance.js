const axios = require("axios");

module.exports = async (req, res) => {
  const { ticker } = req.query;

  if (!ticker) {
    return res.status(400).json({ error: "Ticker is required" });
  }

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}.T`;

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "application/json",
      },
    });
    res.status(200).json(response.data);
  } catch (error) {
    console.error("Error fetching Yahoo Finance data:", {
      message: error.message,
      response: error.response ? error.response.data : null,
      status: error.response ? error.response.status : null,
      headers: error.response ? error.response.headers : null,
    });

    res
      .status(500)
      .json({ error: "Failed to fetch data", details: error.message });
  }
};
