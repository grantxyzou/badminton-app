export default function AttendanceBars() {
  const heights = [30, 55, 42, 70, 38, 60, 48, 80];
  return (
    <svg viewBox="0 0 200 80" width="100%" role="img" aria-label="Attendance bar chart placeholder">
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 24 + 6}
          y={78 - h}
          width={18}
          height={h}
          rx={3}
          fill="var(--accent, #22c55e)"
          fillOpacity={0.18 + (i / heights.length) * 0.4}
        />
      ))}
    </svg>
  );
}
