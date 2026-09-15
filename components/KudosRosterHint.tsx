'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { readStored, useClientValue } from '@/lib/useClientValue';
import { isoWeekKey } from '@/lib/kudos';

const DISMISS_KEY = 'badminton_kudos_hint_dismissed';

/**
 * One line above the Sign-Ups roster pointing at the per-name kudos button.
 *
 * The button was already on every row and still went unfound — a player asked
 * "how do I give kudos to other people?". A glyph with an aria-label explains
 * itself to a screen reader and to nobody else.
 *
 * Dismissal is stored as the ISO WEEK it happened in, so the hint comes back
 * the next week rather than never. That is the same unit kudos dedupe on
 * (`isoWeekKey`), so "you can thank them again" and "here's how" reset together.
 *
 * Neutral ink, not accent: Sign-Ups spends its accent on signing up.
 */
export default function KudosRosterHint() {
  const t = useTranslations('players');
  // `true` on the server and during hydration: hidden until we know, so it
  // never flashes in and then disappears for someone who dismissed it.
  const dismissedThisWeek = useClientValue(
    () => readStored(DISMISS_KEY) === isoWeekKey(new Date()),
    true,
  );
  const [justDismissed, setJustDismissed] = useState(false);
  if (dismissedThisWeek || justDismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, isoWeekKey(new Date())); } catch { /* ignore */ }
    setJustDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 px-2">
      <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        volunteer_activism
      </span>
      <p className="fs-sm" style={{ flex: 1, margin: '0', color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
        {t('kudosHint')}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('kudosHintDismiss')}
        className="cc-btn cc-btn-ghost"
        style={{ padding: 'var(--space-1)', color: 'var(--text-muted)', flexShrink: 0 }}
      >
        <span className="material-icons icon-sm" aria-hidden="true">close</span>
      </button>
    </div>
  );
}
