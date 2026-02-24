export default function Loading() {
  return (
    <>
      <h2 className="mb-lg" style={{ color: "var(--text-heading)" }}>Daily Briefing</h2>
      <div style={{ padding: 40, textAlign: "center" }}>
        <span className="spinner" />
      </div>
    </>
  );
}
