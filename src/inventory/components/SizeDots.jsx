export default function SizeDots({ sizes }) {
  const entries = Object.entries(sizes);
  const max = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 22 }}>
      {entries.map(([s, v]) => {
        const h = Math.max(3, Math.round((v / max) * 18));
        const out = v === 0;
        return (
          <div key={s} title={`${s}: ${v}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <div
              style={{
                width: 10,
                height: h,
                background: out ? "var(--danger)" : "var(--accent)",
                opacity: out ? 1 : 0.7,
                borderRadius: 1.5
              }}
            />
            <span style={{ fontSize: 9, color: "var(--text-faint)", lineHeight: 1 }}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}
