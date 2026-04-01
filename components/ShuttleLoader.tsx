'use client';

/**
 * BPM waveform loading animation.
 * Visualizes the sound of a shuttlecock smash — sharp spike, quick decay, rhythmic loop.
 * "BPM" = group name + beats per minute.
 */

const BAR_COUNT = 14;

// Height pattern mimicking a smash waveform: quiet → SPIKE → decay → quiet
const SMASH_PATTERN = [0.15, 0.2, 0.25, 0.4, 0.7, 0.95, 1.0, 0.85, 0.55, 0.35, 0.25, 0.2, 0.15, 0.12];

export default function ShuttleLoader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 select-none" role="status" aria-label={text}>
      <div className="wave-loader" aria-hidden="true">
        {SMASH_PATTERN.map((intensity, i) => (
          <div
            key={i}
            className="wave-bar"
            style={{
              '--intensity': intensity,
              '--delay': `${i * 0.07}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>
      <p className="text-sm mt-5" style={{ color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{text}</p>
    </div>
  );
}

/**
 * Subtle shimmer placeholder lines for section-level loading (<2s).
 */
export function ShimmerLoader({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 py-4 px-2" role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="shimmer-line rounded-lg"
          style={{
            height: 12,
            width: `${75 - i * 15}%`,
            animationDelay: `${i * 150}ms`,
          }}
        />
      ))}
    </div>
  );
}
