'use client';

import { createContext, useContext, type ReactNode } from 'react';
import CardHeader from '@/components/primitives/CardHeader';

/**
 * Where "Sign in" goes. Provided once by SkillsTab (which knows how to reach
 * Profile) so nine cards nested inside four registers do not each thread a
 * callback. Absent (a card rendered on its own, as in tests), the card still
 * locks — it just has no button to offer.
 */
export const StatsSignInContext = createContext<(() => void) | null>(null);

interface LockedCardProps {
  icon?: string;
  /** Omitted for the headerless cards (the greeting, the pick rail) that never had one. */
  title?: string;
  subtitle?: string;
  /**
   * What signing in would show, in one sentence, with "Sign in" as the link:
   * `t.rich('locked', { link: signInLink })` using `useSignInLink()` below.
   */
  message: ReactNode;
  /** The card's own layout with no values in it: dashes and empty bars, never invented numbers. */
  children: ReactNode;
}

/**
 * The rich-text renderer for a locked sentence's `<link>` chunk: the words
 * "Sign in" become the control. With no destination (a card rendered on its
 * own) the words stay plain text rather than a link that goes nowhere.
 */
export function useSignInLink() {
  const onSignIn = useContext(StatsSignInContext);
  return function SignInLink(chunks: ReactNode) {
    return onSignIn ? (
      <button type="button" className="locked-link" onClick={onSignIn}>
        {chunks}
      </button>
    ) : (
      <>{chunks}</>
    );
  };
}

/**
 * A Stats card this device is not allowed to fill (the server answered 403:
 * no session for the name). Grant, 2026-09-14: keep the card and show what a
 * populated one would look like.
 *
 * Built from the existing locked material (`.glass-card.is-locked`, the same
 * flat surface WhereYouSitCard uses for a private comparison) so a locked card
 * reads as withheld rather than loading. The preview is `aria-hidden`: it is
 * shape, not content, and a screen reader gets the sentence and its link.
 *
 * The way in is the words "Sign in" inside the sentence, as a link. Two louder
 * versions came first and were both too much down a whole tab: a full-width
 * button per card ("too many sign in all over the page"), then a chip in each
 * header ("take those tags out. Hyperlink the text instead").
 */
export default function LockedCard({ icon, title, subtitle, message, children }: LockedCardProps) {
  return (
    <section className="glass-card is-locked p-5 flex flex-col gap-4" aria-label={title}>
      {title && <CardHeader icon={icon} title={title} subtitle={subtitle} />}
      <div className="locked-preview" aria-hidden="true">
        {children}
      </div>
      <p className="fs-base" style={{ margin: '0', color: 'var(--text-secondary)' }}>
        {message}
      </p>
    </section>
  );
}

/** One row of a list preview: an optional leading glyph, a label bar, a value dash. */
export function PreviewRow({ icon, width = '55%', value = '—' }: { icon?: string; width?: string; value?: string }) {
  return (
    <div className="locked-row">
      {icon && (
        <span className="material-icons" style={{ fontSize: 'var(--icon-sm)' }}>
          {icon}
        </span>
      )}
      <span className="locked-line" style={{ width }} />
      {value && <span className="locked-dash">{value}</span>}
    </div>
  );
}

/** A labelled empty meter — the shape of a score or a share, with nothing in it. */
export function PreviewMeter({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <span className="fs-sm">{label}</span>
      <span className="locked-bar" />
    </div>
  );
}
