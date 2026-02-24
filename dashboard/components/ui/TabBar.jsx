"use client";

export default function TabBar({ tabs, activeTab, onTabChange }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderBottom: "1px solid var(--border-primary)",
        marginBottom: 16,
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          style={{
            padding: "8px 20px",
            background: "transparent",
            border: "none",
            borderBottom:
              activeTab === tab
                ? "2px solid var(--accent-blue)"
                : "2px solid transparent",
            color:
              activeTab === tab ? "var(--accent-blue)" : "var(--text-muted)",
            cursor: "pointer",
            fontWeight: activeTab === tab ? 600 : 400,
            fontSize: "0.9rem",
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
