import type { CSSProperties, ReactNode } from 'react';

/**
 * Status badge — the small uppercase pill that appears in card headers and
 * tiles ("Live" / "Beta" / "Coming soon") and as the skill-phase tag. Replaces
 * the ~6-8 hand-rolled inline pill blocks across the stats cards, which had
 * drifted on font size (9/10/11) and padding (2px 7px / 3px 8px / 3px 10px).
 *
 * One shared shape; pick a variant:
 *   - `accent` (default) — the Live/Beta pill (accent border + text, --fs-2xs)
 *   - `muted`            — the compact "Coming soon" tag (muted border/text, 9px)
 *   - `phase`            — the larger skill-phase tag; pass `tone="amber"` for
 *                          the "switch" phase, else accent
 *   - `state`            — a FILLED pill in one of the canonical `.pill-*`
 *                          tones (`paid` / `unpaid` / `waitlist` / `admin`,
 *                          globals.css): the sign-up roster's paid/unpaid chips
 *                          and the stringing bench's job status. Shape, padding
 *                          and colour all come from the class, so a status chip
 *                          cannot be typed from memory again (the bench's was,
 *                          at a --fs-sm padding on --fs-2xs text).
 *
 * Every variant here describes the STATE of a thing. The AI provenance marker
 * used to live here as `variant="ai"` and never fitted — it answers "where did
 * this text come from", not "what state is this in", and it was the only
 * variant that early-returned with its own DOM and a CSS class instead of
 * being a style object. It is now `<AIBadge>`.
 *
 * Colors come from tokens (`--accent` / `--accent-amber` / `--inner-card-border`
 * / `--text-muted`); radius from `--radius-pill`. Text is the children.
 */
export type StatusBadgeVariant = 'accent' | 'muted' | 'phase' | 'state';
export type StateTone = 'paid' | 'unpaid' | 'waitlist' | 'admin';

export interface StatusBadgeProps {
  children: ReactNode;
  variant?: StatusBadgeVariant;
  /** `phase`: `accent` | `amber`. `state`: one of the `.pill-*` tones. */
  tone?: 'accent' | 'amber' | StateTone;
  /** For `variant="state"`: a label for assistive tech when the text alone is terse. */
  ariaLabel?: string;
}

/**
 * PILL PADDING STEPS WITH ITS TEXT. One rung of the spacing ladder per rung
 * of the type scale:
 *
 *   --fs-2xs (10px)  ->  var(--space-1) var(--space-3)   4 / 8
 *   --fs-xs  (11px)  ->  var(--space-1) var(--space-4)   4 / 12
 *   --fs-sm+ (12px+) ->  var(--space-2) var(--space-4)   6 / 12
 *
 * Before the spacing audit this component alone carried three different
 * paddings across its three variants, and --fs-2xs pills elsewhere in the app
 * were rendered at four more (1/6, 2/8, 3/9, 4/8). They were not decisions;
 * they were the same value typed from memory in eight places. Any new pill --
 * here or hand-rolled -- takes the row that matches its font size.
 */
const BASE: CSSProperties = {
  display: 'inline-block',
  borderRadius: 'var(--radius-pill)',
  whiteSpace: 'nowrap',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

export default function StatusBadge({ children, variant = 'accent', tone = 'accent', ariaLabel }: StatusBadgeProps) {
  if (variant === 'state') {
    const t: StateTone = tone === 'paid' || tone === 'unpaid' || tone === 'waitlist' || tone === 'admin' ? tone : 'waitlist';
    return <span className={`pill-${t}`} aria-label={ariaLabel}>{children}</span>;
  }
  let style: CSSProperties;
  if (variant === 'muted') {
    style = { ...BASE, fontSize: 'var(--fs-2xs)', padding: 'var(--space-1) var(--space-3)', border: '1px solid var(--inner-card-border)', color: 'var(--text-muted)' };
  } else if (variant === 'phase') {
    const c = tone === 'amber' ? 'var(--accent-amber)' : 'var(--accent)';
    style = { ...BASE, fontSize: 'var(--fs-xs)', padding: 'var(--space-1) var(--space-4)', border: `1px solid ${c}`, color: c };
  } else {
    style = { ...BASE, fontSize: 'var(--fs-2xs)', padding: 'var(--space-1) var(--space-3)', border: '1px solid var(--accent, #22c55e)', color: 'var(--accent, #22c55e)' };
  }
  return <span style={style}>{children}</span>;
}
