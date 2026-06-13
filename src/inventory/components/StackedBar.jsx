export default function StackedBar({ rows }) {
  const max = Math.max(...rows.map((r) => r.segments.reduce((s, x) => s + x.value, 0)), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 16px 16px" }}>
      {rows.map((r) => {
        const total = r.segments.reduce((s, x) => s + x.value, 0);
        return (
          <div
            key={r.label}
            style={{
              display: "grid",
              gridTemplateColumns: "110px 1fr 70px",
              alignItems: "center",
              gap: 12,
              fontSize: 12
            }}
          >
            <span style={{ color: "var(--text-muted)" }}>{r.label}</span>
            <div
              style={{
                display: "flex",
                height: 14,
                borderRadius: 3,
                overflow: "hidden",
                background: "var(--bg-subtle)",
                width: `${(total / max) * 100}%`,
                minWidth: 4
              }}
            >
              {r.segments.map((s, i) => (
                <div key={i} title={`${s.label}: ${s.value}`} style={{ flex: s.value, background: s.color }} />
              ))}
            </div>
            <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
              {total.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
