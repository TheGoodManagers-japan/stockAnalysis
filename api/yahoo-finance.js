const axios = require("axios");

module.exports = async (req, res) => {
  const { ticker } = req.query;

  if (!ticker) {
    return res.status(400).json({ error: "Ticker is required" });
  }

  const url = `https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/v2/get-summary`;

  try {
    const response = await axios.get(url, {
      params: { symbol: `${ticker}.T`, region: "JP" },
      headers: {
        "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
        "X-RapidAPI-Host": "apidojo-yahoo-finance-v1.p.rapidapi.com",
      },
    });
    res.status(200).json(response.data);
  } catch (error) {
    console.error("Error fetching data from RapidAPI:", error.message);
    res
      .status(500)
      .json({ error: "Failed to fetch data", details: error.message });
  }
};
