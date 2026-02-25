import { query } from "../../lib/db";

export const dynamic = "force-dynamic";

async function getSectorRotation() {
  try {
    const result = await query(
      `SELECT * FROM sector_rotation_snapshots
       WHERE scan_date = (SELECT MAX(scan_date) FROM sector_rotation_snapshots)
       ORDER BY composite_score DESC`
    );
    return result.rows;
  } catch {
    return [];
  }
}

function formatSector(s) {
  if (!s) return "-";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreColor(score) {
  if (score == null) return "var(--text-muted)";
  const s = Number(score);
  if (s >= 70) return "var(--accent-green)";
  if (s >= 50) return "var(--accent-blue)";
  if (s >= 30) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

function heatmapBg(score) {
  if (score == null) return "var(--bg-tertiary)";
  const s = Number(score);
  if (s >= 70) return "rgba(34, 197, 94, 0.15)";
  if (s >= 50) return "rgba(59, 130, 246, 0.1)";
  if (s >= 30) return "rgba(234, 179, 8, 0.1)";
  return "rgba(239, 68, 68, 0.1)";
}

export default async function SectorsPage() {
  const sectors = await getSectorRotation();

  return (
    <>
      <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>
        Sector Rotation
      </h2>

      {sectors.length === 0 ? (
        <div className="card">
          <p className="text-muted">
            No sector rotation data yet. Run a scan to generate sector analysis.
          </p>
        </div>
      ) : (
        <>
          {/* Heatmap grid */}
          <div
            className="mb-lg"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {sectors.map((s) => (
              <div
                key={s.sector_id}
                className="card"
                style={{
                  background: heatmapBg(s.composite_score),
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    marginBottom: 8,
                    color: "var(--text-heading)",
                  }}
                >
                  {formatSector(s.sector_id)}
                </div>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono)",
                    color: scoreColor(s.composite_score),
                    marginBottom: 8,
                  }}
                >
                  {s.composite_score != null
                    ? Number(s.composite_score).toFixed(1)
                    : "-"}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 4,
                    fontSize: "0.72rem",
                  }}
                >
                  <div>
                    <span className="text-muted">RS5</span>
                    <div className="text-mono">
                      {s.rs_5 != null ? Number(s.rs_5).toFixed(2) : "-"}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted">RS10</span>
                    <div className="text-mono">
                      {s.rs_10 != null ? Number(s.rs_10).toFixed(2) : "-"}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted">RS20</span>
                    <div className="text-mono">
                      {s.rs_20 != null ? Number(s.rs_20).toFixed(2) : "-"}
                    </div>
                  </div>
                </div>
                {s.recommendation && (
                  <div style={{ marginTop: 8 }}>
                    <span
                      className={`badge ${
                        s.recommendation === "overweight"
                          ? "badge-buy"
                          : s.recommendation === "underweight"
                          ? "badge-sell"
                          : "badge-neutral"
                      }`}
                    >
                      {s.recommendation}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Leaderboard table */}
          <div className="card">
            <div className="card-title mb-md">Sector Leaderboard</div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Sector</th>
                    <th>Score</th>
                    <th>RS5</th>
                    <th>RS10</th>
                    <th>RS20</th>
                    <th>RS60</th>
                    <th>Accel</th>
                    <th>Breadth MA20</th>
                    <th>Breadth MA200</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {sectors.map((s, i) => (
                    <tr key={s.sector_id}>
                      <td>{i + 1}</td>
                      <td style={{ fontWeight: 500 }}>
                        {formatSector(s.sector_id)}
                      </td>
                      <td
                        className="text-mono"
                        style={{ color: scoreColor(s.composite_score) }}
                      >
                        {s.composite_score != null
                          ? Number(s.composite_score).toFixed(1)
                          : "-"}
                      </td>
                      <td className="text-mono">
                        {s.rs_5 != null ? Number(s.rs_5).toFixed(2) : "-"}
                      </td>
                      <td className="text-mono">
                        {s.rs_10 != null ? Number(s.rs_10).toFixed(2) : "-"}
                      </td>
                      <td className="text-mono">
                        {s.rs_20 != null ? Number(s.rs_20).toFixed(2) : "-"}
                      </td>
                      <td className="text-mono">
                        {s.rs_60 != null ? Number(s.rs_60).toFixed(2) : "-"}
                      </td>
                      <td
                        className="text-mono"
                        style={{
                          color:
                            Number(s.accel_swing) > 0
                              ? "var(--accent-green)"
                              : "var(--accent-red)",
                        }}
                      >
                        {s.accel_swing != null
                          ? Number(s.accel_swing).toFixed(2)
                          : "-"}
                      </td>
                      <td className="text-mono">
                        {s.breadth_5 != null
                          ? `${(Number(s.breadth_5) * 100).toFixed(0)}%`
                          : "-"}
                      </td>
                      <td className="text-mono">
                        {s.breadth_20 != null
                          ? `${(Number(s.breadth_20) * 100).toFixed(0)}%`
                          : "-"}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            s.recommendation === "overweight"
                              ? "badge-buy"
                              : s.recommendation === "underweight"
                              ? "badge-sell"
                              : "badge-neutral"
                          }`}
                        >
                          {s.recommendation || "-"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
