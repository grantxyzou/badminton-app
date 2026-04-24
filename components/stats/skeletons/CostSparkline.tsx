export default function CostSparkline() {
  const points = [12, 18, 14, 20, 24, 19, 26, 22];
  const stride = 26;
  const offsetX = 8;
  const pathPoints = points.map((v, i) => `${offsetX + i * stride},${70 - v * 2}`).join(' ');
  return (
    <svg viewBox="0 0 220 80" width="100%" role="img" aria-label="Cost trend placeholder">
      <polyline
        points={pathPoints}
        fill="none"
        stroke="var(--accent, #22c55e)"
        strokeWidth={2}
        strokeOpacity={0.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((v, i) => (
        <circle
          key={i}
          cx={offsetX + i * stride}
          cy={70 - v * 2}
          r={3}
          fill="var(--accent, #22c55e)"
          fillOpacity={0.85}
        />
      ))}
    </svg>
  );
}
