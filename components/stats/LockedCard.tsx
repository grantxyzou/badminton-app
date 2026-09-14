'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
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
  /** Omitted for the headerless cards (Learn, the pick rail) that never had one. */
  title?: string;
  subtitle?: string;
  /** What signing in would show, in one sentence. */
  message: string;
  /** The card's own layout with no values in it: dashes and empty bars, never invented numbers. */
  children: ReactNode;
}

/**
 * A Stats card this device is not allowed to fill (the server answered 403:
 * no session for the name). Grant, 2026-09-14: keep the card, show what a
 * populated one would look like, and give "Sign in" real weight on each card.
 *
 * Built from the existing locked material (`.glass-card.is-locked`, the same
 * flat surface WhereYouSitCard uses for a private comparison) so a locked card
 * reads as withheld rather than loading. The preview is `aria-hidden`: it is
 * shape, not content, and a screen reader gets the sentence and the button.
 *
 * The button is `cc-btn-primary`, deliberately NOT the ghost that EmptyState
 * prescribes. An empty card has nothing to do about it; a locked card has one
 * thing to do, and it is the point of the card.
 */
export default function LockedCard({ icon, title, subtitle, message, children }: LockedCardProps) {
  const t = useTranslations('stats');
  const onSignIn = useContext(StatsSignInContext);
  return (
    <section className="glass-card is-locked p-5 flex flex-col gap-4" aria-label={title ?? message}>
      {title && (
        <CardHeader
          icon={icon}
          title={title}
          subtitle={subtitle}
          badge={
            <span className="locked-pill">
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-xs)' }}>
                lock
              </span>
              {t('lockedPill')}
            </span>
          }
        />
      )}
      <div className="locked-preview" aria-hidden="true">
        {children}
      </div>
      <div className="locked-unlock">
        <p className="fs-base" style={{ margin: '0', color: 'var(--text-secondary)' }}>
          {message}
        </p>
        {onSignIn && (
          <button type="button" className="cc-btn cc-btn-primary cc-btn-lg locked-unlock-cta" onClick={onSignIn}>
            {t('signIn')}
          </button>
        )}
      </div>
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
