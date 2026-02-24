export default function Loading() {
  return (
    <>
      <h2 style={{ color: "var(--text-heading)" }}>Portfolio</h2>
      <div style={{ padding: 40, textAlign: "center" }}>
        <span className="spinner" />
      </div>
    </>
  );
}
