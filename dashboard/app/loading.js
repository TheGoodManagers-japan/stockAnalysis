export default function Loading() {
  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <span className="spinner" />
      <p className="text-muted" style={{ marginTop: 12, fontSize: "0.85rem" }}>
        Loading dashboard...
      </p>
    </div>
  );
}
