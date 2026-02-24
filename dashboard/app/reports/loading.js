export default function Loading() {
  return (
    <>
      <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>Reports</h2>
      <div style={{ padding: 40, textAlign: "center" }}>
        <span className="spinner" />
      </div>
    </>
  );
}
