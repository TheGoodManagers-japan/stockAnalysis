import { fetchYahooFinanceData } from "../lib/yahoo.js";

(async () => {
    try {
        console.log("Testing Yahoo Finance fetch for 7203.T (Toyota)...");
        const data = await fetchYahooFinanceData("7203.T");
        console.log("✅ Success!");
        console.log("Current Price:", data.currentPrice);
        console.log("Market Cap:", data.marketCap);
    } catch (e) {
        console.error("❌ Failed:", e.message);
        if (e.details) {
            console.error("Details:", JSON.stringify(e.details, null, 2));
        }
    }
})();
