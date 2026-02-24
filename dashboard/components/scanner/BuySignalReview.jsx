"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./BuySignalReview.module.css";
import stockCardStyles from "./StockCard.module.css";
import { VERDICT_CONFIG as BASE_VERDICT, formatSector } from "../../lib/uiHelpers";

const VERDICT_CONFIG = {
    CONFIRMED: { ...BASE_VERDICT.CONFIRMED, cssClass: styles.confirmed, cardClass: styles.verdictConfirmed },
    CAUTION: { ...BASE_VERDICT.CAUTION, cssClass: styles.caution, cardClass: styles.verdictCaution },
    AVOID: { ...BASE_VERDICT.AVOID, cssClass: styles.avoid, cardClass: styles.verdictAvoid },
};

export default function BuySignalReview() {
    const [reviews, setReviews] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    async function runReview() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/scan/ai-review");
            const data = await res.json();
            if (data.success) {
                setReviews(data.reviews);
            } else {
                setError(data.error || "Failed to run AI review");
            }
        } catch (err) {
            setError(err.message || "Network error");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <div className="flex-between mb-md">
                <h3 style={{ color: "var(--text-heading)", fontSize: "1.05rem", fontWeight: 600 }}>
                    AI Buy Signal Review
                </h3>
                <button
                    className={styles.reviewBtn}
                    onClick={runReview}
                    disabled={loading}
                >
                    {loading ? (
                        <>
                            <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                            Analyzing...
                        </>
                    ) : (
                        <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                            </svg>
                            Run AI Review
                        </>
                    )}
                </button>
            </div>

            {error && (
                <div
                    className="card mb-md"
                    style={{
                        borderColor: "var(--accent-red)",
                        color: "var(--accent-red)",
                        fontSize: "0.85rem",
                    }}
                >
                    ⚠️ {error}
                </div>
            )}

            {loading && !reviews && (
                <div className={styles.loading}>
                    <span className="spinner" style={{ width: 32, height: 32 }} />
                    <span>Analyzing buy signals with AI...</span>
                    <span className="text-muted" style={{ fontSize: "0.78rem" }}>
                        Reviewing company info, recent news, and earnings data
                    </span>
                </div>
            )}

            {reviews && reviews.length === 0 && (
                <div className="card">
                    <p className="text-muted">No buy signals to review.</p>
                </div>
            )}

            {reviews && reviews.length > 0 && (
                <div className={stockCardStyles.grid}>
                    {reviews.map((r) => {
                        const verdict = VERDICT_CONFIG[r.verdict] || VERDICT_CONFIG.CAUTION;
                        return (
                            <div
                                key={r.ticker_code}
                                className={`${styles.reviewCard} ${verdict.cardClass}`}
                            >
                                <div className={styles.header}>
                                    <div>
                                        <Link
                                            href={`/scanner/${r.ticker_code}`}
                                            className={stockCardStyles.ticker}
                                        >
                                            {r.ticker_code}
                                        </Link>
                                        <div className={stockCardStyles.name}>
                                            {r.short_name || r.ticker_code}
                                        </div>
                                        {r.sector && (
                                            <div
                                                style={{
                                                    fontSize: "0.7rem",
                                                    color: "var(--text-muted)",
                                                    marginTop: 2,
                                                }}
                                            >
                                                {formatSector(r.sector)}
                                            </div>
                                        )}
                                    </div>
                                    <div className={`${styles.verdict} ${verdict.cssClass}`}>
                                        {verdict.icon} {verdict.label}
                                    </div>
                                </div>

                                {/* Quick metrics row */}
                                <div
                                    style={{
                                        display: "flex",
                                        gap: 12,
                                        marginBottom: 14,
                                        flexWrap: "wrap",
                                    }}
                                >
                                    {r.current_price && (
                                        <span
                                            className="text-mono"
                                            style={{ fontSize: "0.82rem" }}
                                        >
                                            ¥{Number(r.current_price).toLocaleString()}
                                        </span>
                                    )}
                                    {r.tier && (
                                        <span className={`badge badge-tier-${r.tier}`}>
                                            T{r.tier}
                                        </span>
                                    )}
                                    {r.market_regime && (
                                        <span
                                            className={`badge ${r.market_regime === "STRONG_UP" || r.market_regime === "UP"
                                                    ? "badge-buy"
                                                    : r.market_regime === "DOWN"
                                                        ? "badge-sell"
                                                        : "badge-neutral"
                                                }`}
                                        >
                                            {r.market_regime}
                                        </span>
                                    )}
                                </div>

                                {/* Company Description */}
                                <div className={styles.section}>
                                    <div className={styles.sectionTitle}>Company</div>
                                    <div className={styles.sectionText}>
                                        {r.company_description || "-"}
                                    </div>
                                </div>

                                {/* News Summary */}
                                <div className={styles.section}>
                                    <div className={styles.sectionTitle}>Recent News</div>
                                    <div className={styles.sectionText}>
                                        {r.news_summary || "No recent news"}
                                    </div>
                                </div>

                                {/* Earnings / Fundamentals */}
                                <div className={styles.section}>
                                    <div className={styles.sectionTitle}>
                                        Earnings & Fundamentals
                                    </div>
                                    <div className={styles.sectionText}>
                                        {r.earnings_status || "-"}
                                    </div>
                                </div>

                                {/* Verdict Reason */}
                                <div
                                    style={{
                                        padding: "10px 14px",
                                        background: "var(--bg-tertiary)",
                                        borderRadius: "var(--radius-md)",
                                        fontSize: "0.85rem",
                                        color: "var(--text-primary)",
                                        lineHeight: 1.6,
                                        fontWeight: 500,
                                    }}
                                >
                                    {verdict.icon} {r.verdict_reason || "-"}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
