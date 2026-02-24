export default function Loading() {
  return (
    <>
      <h2 style={{ color: "var(--text-heading)", margin: 0 }}>ML Top Picks</h2>
      <div style={{ padding: 40, textAlign: "center" }}>
        <span className="spinner" />
      </div>
    </>
  );
}
