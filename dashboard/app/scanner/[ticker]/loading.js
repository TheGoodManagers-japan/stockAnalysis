export default function Loading() {
  return (
    <>
      <div className="mb-md">
        <span style={{ color: "var(--accent-blue)", fontSize: "0.85rem" }}>
          &larr; Back to Scanner
        </span>
      </div>
      <div className="grid-3 mb-lg">
        <div className="card" style={{ height: 180, background: "var(--bg-secondary)" }} />
        <div className="card" style={{ height: 180, background: "var(--bg-secondary)" }} />
        <div className="card" style={{ height: 180, background: "var(--bg-secondary)" }} />
      </div>
      <div
        className="card mb-lg"
        style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <span className="spinner" />
      </div>
    </>
  );
}
