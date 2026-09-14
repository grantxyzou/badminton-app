import type { ReactNode } from 'react';
import CardHeader from './CardHeader';

/**
 * The glass card, tinted by what state it is in.
 *
 * Grant, 2026-09-14: "since the card itself is a glass that refracts colour
 * and light, why not have the card show red when there is an error and other
 * status". So the STATUS lives in the material — a red wash through the glass
 * and a red rim — and the words stay a plain sentence with an inline link,
 * the same shape the Stats locked cards settled on (no buttons, no tags).
 *
 * The preview is the card's own layout with nothing in it (dashes, empty
 * bars), so a failed Payments card still reads as Payments. It is
 * `aria-hidden`: shape, not content.
 *
 * Tones are defined once in `globals.css` (`.glass-card[data-tone]`). Add a
 * tone there before using it here.
 */
export type StateTone = 'danger' | 'warn' | 'success';

export interface StateCardProps {
  tone: StateTone;
  icon?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** One sentence, usually ending in a `<StateLink>` ("Couldn't load payments. Try again"). */
  message: ReactNode;
  /** The card's layout with no values in it. Optional: some cards have no shape worth drawing. */
  children?: ReactNode;
}

export default function StateCard({ tone, icon, title, subtitle, message, children }: StateCardProps) {
  return (
    <section
      className="glass-card p-5 flex flex-col gap-4"
      data-tone={tone}
      aria-label={typeof title === 'string' ? title : undefined}
    >
      {title && <CardHeader icon={icon} title={title} subtitle={subtitle} />}
      {children && (
        <div className="state-preview" aria-hidden="true">
          {children}
        </div>
      )}
      <p
        className="fs-base state-message"
        // A failure is announced; anything else is polite.
        role={tone === 'danger' ? 'alert' : 'status'}
        style={{ margin: '0' }}
      >
        {message}
      </p>
    </section>
  );
}

/** The one control a state card carries: inline, underlined, in the tone's ink. */
export function StateLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="state-link" onClick={onClick}>
      {children}
    </button>
  );
}

/** One row of a list preview: an optional leading glyph, a label bar, a value dash. */
export function PreviewRow({ icon, width = '55%', value = '—' }: { icon?: string; width?: string; value?: string }) {
  return (
    <div className="state-row">
      {icon && (
        <span className="material-icons" style={{ fontSize: 'var(--icon-sm)' }}>
          {icon}
        </span>
      )}
      <span className="state-line" style={{ width }} />
      {value && <span className="state-dash">{value}</span>}
    </div>
  );
}

/** A labelled empty meter — the shape of a score or a share, with nothing in it. */
export function PreviewMeter({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <span className="fs-sm">{label}</span>
      <span className="state-bar" />
    </div>
  );
}
