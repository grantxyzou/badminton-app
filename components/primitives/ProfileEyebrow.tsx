import type { ReactNode } from 'react';

/**
 * The uppercase section eyebrow used above Profile's card groups ("Settings",
 * "What others can see"). Sits OUTSIDE the card it labels, unlike
 * `CardHeader`, which sits inside one.
 *
 * Lifted out of `ProfileTab` when the Stats & privacy sub-screen needed it:
 * importing it back from `ProfileTab` would have been a circular import, since
 * `ProfileTab` renders that screen. Extracting also stops the alternative,
 * which was a near-copy that drifts.
 */
export default function ProfileEyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-display, "Space Grotesk")',
        fontSize: 'var(--fs-xs)',
        fontWeight: 700,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        // No rgba fallback: --ink-faint is defined for both themes in
        // globals.css, so the fallback was dead code that also happened to
        // hardcode the dark value. This directory lints bare rgba() at error
        // level, which is what surfaced it when the eyebrow moved here.
        color: 'var(--ink-faint)',
        margin: '8px 4px -2px',
      }}
    >
      {children}
    </p>
  );
}
