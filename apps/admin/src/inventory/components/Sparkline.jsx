export default function Sparkline({ data, color = "var(--accent)", height = 36 }) {
  const safe = Array.isArray(data) && data.length ? data : [0, 0];
  const max = Math.max(...safe);
  const min = Math.min(...safe);
  const range = Math.max(1, max - min);
  const pts = safe
    .map((v, i) => {
      const x = safe.length === 1 ? 50 : (i / (safe.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");
  const areaPts = `0,100 ${pts} 100,100`;

  return (
    <svg className="spark" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }}>
      <polygon points={areaPts} fill={color} opacity="0.08" />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
