async function fetchStockAnalysis() {
  try {
    const response = await fetch(
      "https://stock-analysis-thegoodmanagers-japan-aymerics-projects-60f33831.vercel.app/api/stocks"
    ); // Relative URL for Vercel deployment
    const data = await response.json();

    if (data.success) {
      console.log("Top Stocks by Sector:", data.data);
    } else {
      console.error("Error fetching stock analysis:", data.message);
    }
  } catch (error) {
    console.error("Fetch Error:", error.message);
  }
}

