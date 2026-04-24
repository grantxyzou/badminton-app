import { memo } from 'react';

/**
 * BPM wordmark — the chat-picked "C+D merge": "bpm" followed by four
 * tempo dots that crescendo into the period (0.12→0.24em, 0.32→1.0 opacity).
 * Sizes as ems so the ladder holds from 20px to 96px.
 *
 * Accent color follows `var(--accent)` so it auto-tints for light/dark themes.
 */
function BpmWordmark({
  size = '1em',
  color,
  ariaLabel = 'BPM',
}: {
  size?: string;
  color?: string;
  ariaLabel?: string | null;
}) {
  return (
    <span
      role="img"
      aria-label={ariaLabel ?? undefined}
      aria-hidden={ariaLabel === null ? true : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'flex-end',
        // Bundle v3: wordmark uses --font-display (Space Grotesk) at weight 700.
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '-0.04em',
        color: color ?? 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      bpm
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'flex-end',
          gap: '0.11em',
          marginLeft: '0.06em',
          paddingBottom: '0.05em',  // align baseline of dots with text baseline
        }}
      >
        <span style={{ display: 'inline-block', width: '0.18em', height: '0.18em', borderRadius: '50%', background: 'var(--accent)', opacity: 0.32 }} />
        <span style={{ display: 'inline-block', width: '0.22em', height: '0.22em', borderRadius: '50%', background: 'var(--accent)', opacity: 0.55 }} />
        <span style={{ display: 'inline-block', width: '0.26em', height: '0.26em', borderRadius: '50%', background: 'var(--accent)', opacity: 0.78 }} />
        <span style={{ display: 'inline-block', width: '0.32em', height: '0.32em', borderRadius: '50%', background: 'var(--accent)' }} />
      </span>
    </span>
  );
}

export default memo(BpmWordmark);
