'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { readStored, useClientValue } from '@/lib/useClientValue';
import { useRevealReady } from '@/components/primitives/Reveal';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const DISMISS_KEY = 'badminton_skill_discovery_dismissed';

/**
 * Home discovery hook for the skill-assessment feature. Surfaces at the
 * sign-up touchpoint (the one entry moment we can rely on) to introduce skill
 * rating. Self-retiring: shows only to an identified player who hasn't
 * rated yet and hasn't dismissed it — so it never nags. Warmer copy right
 * after a sign-up.
 */
export default function SkillDiscoveryCard({
  name, signedUp, onOpen,
}: {
  name: string | null;
  signedUp: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('home');
  // Hidden until checked — no flash. `true` is both the server answer and the
  // answer for a player we cannot identify, which is what the old effect's
  // early `return` on a null name left standing.
  const storedDismissed = useClientValue(
    () => (name ? readStored(DISMISS_KEY) === '1' : true),
    true,
  );
  const [justDismissed, setJustDismissed] = useState(false);
  const dismissed = storedDismissed || justDismissed;
  const [hasRated, setHasRated] = useState<boolean | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);

  // Self-retire once the player has rated at least once.
  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    fetch(`${BASE}/api/assessments?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setHasRated(((d.assessments ?? []).length) > 0); })
      // Unknown stays unknown: a failed or refused read is not evidence that
      // they never rated, and nudging someone to "rate your skills" who has
      // already done it is a lying empty state wearing a call to action.
      .catch(() => { if (!cancelled) setCheckFailed(true); /* hasRated stays null — render nothing */ });
    return () => { cancelled = true; };
  }, [name]);

  // Show only once we know the player hasn't rated; null = still loading.
  const show = !!name && !dismissed && hasRated === false;
  // Home's RevealSlot holds this place (no space — it is usually absent) and
  // keeps everything below it waiting until the answer is in. Ready waits on
  // the FETCH, not on `dismissed`: that reads `true` before the stored value
  // settles, and a slot that latched "empty" on it would never show the card.
  useRevealReady(!name || hasRated !== null || checkFailed, !show);
  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setJustDismissed(true);
  };

  return (
    // No fade of its own: Home's RevealSlot fades it in, in order.
    <div className="glass-card p-4" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-lg)', color: 'var(--accent, #22c55e)', flexShrink: 0 }}>
        trending_up
      </span>
      <button
        type="button"
        onClick={onOpen}
        style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0' }}
      >
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: '0', fontWeight: 600, lineHeight: 1.3 }}>
          {signedUp ? t('skillDiscovery.titleSignedUp') : t('skillDiscovery.title')}
        </p>
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--accent, #22c55e)', margin: 'var(--space-05) 0 0', fontWeight: 600 }}>
          {t('skillDiscovery.cta')} →
        </p>
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('skillDiscovery.dismiss')}
        className="flex items-center justify-center rounded-full"
        style={{ width: 28, height: 28, background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)', flexShrink: 0 }}
      >
        <span className="material-icons" style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-muted)' }}>close</span>
      </button>
    </div>
  );
}
