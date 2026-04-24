export default function RadarSkeleton() {
  return (
    <svg viewBox="0 0 200 120" width="100%" role="img" aria-label="Radar chart placeholder">
      {[0.3, 0.5, 0.75, 1].map((scale, i) => (
        <polygon
          key={i}
          points={`100,${60 - 42 * scale} ${100 + 39 * scale},${60 - 18 * scale} ${100 + 28 * scale},${60 + 34 * scale} ${100 - 28 * scale},${60 + 34 * scale} ${100 - 39 * scale},${60 - 18 * scale}`}
          fill="none"
          stroke="var(--accent, #22c55e)"
          strokeOpacity={0.22}
          strokeWidth={1}
        />
      ))}
      <polygon
        points="100,26 133,45 122,88 78,88 67,45"
        fill="var(--accent, #22c55e)"
        fillOpacity={0.18}
        stroke="var(--accent, #22c55e)"
        strokeOpacity={0.55}
        strokeWidth={1.5}
      />
    </svg>
  );
}
