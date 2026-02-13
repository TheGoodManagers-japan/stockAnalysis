"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./StockCard.module.css";

const VERDICT_CONFIG = {
    CONFIRMED: { icon: "✅", label: "CONFIRMED", cssClass: "badge-buy", style: { background: "rgba(16, 185, 129, 0.2)", color: "#10b981", borderColor: "#10b981" } },
    CAUTION: { icon: "⚠️", label: "CAUTION", cssClass: "badge-neutral", style: { background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", borderColor: "#f59e0b" } },
    AVOID: { icon: "❌", label: "AVOID", cssClass: "badge-sell", style: { background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", borderColor: "#ef4444" } },
};

export default function StockCard({ stock, initialReview }) {
    const [review, setReview] = useState(initialReview);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    async function handleAnalyze(e) {
        e.preventDefault(); // Prevent Link navigation
        e.stopPropagation();

        setLoading(true);
        try {
            const res = await fetch(`/api/scan/ai-review?ticker=${stock.ticker_code}`);
            const data = await res.json();
            if (data.success && data.reviews && data.reviews.length > 0) {
                setReview(data.reviews[0]);
            }
        } catch (err) {
            console.error("Analysis failed", err);
        } finally {
            setLoading(false);
        }
    }

    const verdict = review ? VERDICT_CONFIG[review.verdict] : null;

    return (
        <div className={`${styles.card} ${styles.cardBuy}${verdict ? ' has-verdict' : ''}`} style={{ position: "relative" }}>
            <Link
                href={`/scanner/${stock.ticker_code}`}
                style={{ position: "absolute", inset: 0, zIndex: 1, cursor: "pointer" }}
                aria-label={`View details for ${stock.ticker_code}`}
            />

            <div className={styles.header} style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>
                <div>
                    <div className={styles.ticker}>
                        {stock.ticker_code}
                    </div>
                    <div className={styles.name}>{stock.short_name || stock.ticker_code}</div>
                </div>
                <div className={styles.badges}>
                    <span className={`badge badge-tier-${stock.tier || 3}`}>
                        T{stock.tier || "?"}
                    </span>
                    {stock.market_regime && (
                        <span className={`badge ${stock.market_regime === "STRONG_UP" || stock.market_regime === "UP"
                                ? "badge-buy"
                                : stock.market_regime === "DOWN" ? "badge-sell" : "badge-neutral"
                            }`}>
                            {stock.market_regime}
                        </span>
                    )}
                </div>
            </div>

            <div className={styles.body} style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>Price</span>
                    <span className={styles.metricValue}>
                        {stock.current_price ? Number(stock.current_price).toLocaleString() : "-"}
                    </span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>Sector</span>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                        {stock.sector ? stock.sector.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "-"}
                    </span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>Stop Loss</span>
                    <span className={styles.metricValue} style={{ color: "var(--accent-red)" }}>
                        {stock.stop_loss ? Number(stock.stop_loss).toLocaleString() : "-"}
                    </span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>Target</span>
                    <span className={styles.metricValue} style={{ color: "var(--accent-green)" }}>
                        {stock.price_target ? Number(stock.price_target).toLocaleString() : "-"}
                    </span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>ST Score</span>
                    <span className={styles.metricValue}>{stock.short_term_score ?? "-"}</span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>LT Score</span>
                    <span className={styles.metricValue}>{stock.long_term_score ?? "-"}</span>
                </div>
            </div>

            <div className={styles.footer} style={{ position: "relative", zIndex: 2, pointerEvents: "none" }}>
                {stock.trigger_type && (
                    <span className="badge badge-buy" style={{ marginRight: 6, marginBottom: 4 }}>
                        {stock.trigger_type}
                    </span>
                )}
                {stock.buy_now_reason}
            </div>

            {/* AI Analysis Section */}
            <div style={{ marginTop: 12, borderTop: "1px solid var(--border-color)", paddingTop: 8, position: "relative", zIndex: 2 }}>
                {review ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={`badge`} style={{ ...verdict?.style, display: "flex", alignItems: "center", gap: 4 }}>
                            {verdict?.icon} {verdict?.label}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {review.verdict_reason}
                        </span>
                    </div>
                ) : (
                    <button
                        onClick={handleAnalyze}
                        disabled={loading}
                        style={{
                            background: "transparent",
                            border: "1px solid var(--accent-blue)",
                            color: "var(--accent-blue)",
                            padding: "4px 12px",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            cursor: loading ? "wait" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            width: "100%",
                            justifyContent: "center",
                            pointerEvents: "auto" // Re-enable pointer events for button
                        }}
                    >
                        {loading ? (
                            <>
                                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                                <span>Analysing...</span>
                            </>
                        ) : (
                            <>
                                <span>✨ Analyze with AI</span>
                            </>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}
