'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isFlagOn } from '@/lib/flags';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const DISMISS_KEY = 'badminton_skill_discovery_dismissed';

/**
 * Home discovery hook for the skill-assessment feature. Surfaces at the
 * sign-up touchpoint (the one entry moment we can rely on) to introduce skill
 * rating. Self-retiring: shows only to a flag-on, identified player who hasn't
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
  const on = isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS');
  const [dismissed, setDismissed] = useState(true); // hidden until checked — no flash
  const [hasRated, setHasRated] = useState<boolean | null>(null);

  useEffect(() => {
    if (!on || !name) return;
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, [on, name]);

  // Self-retire once the player has rated at least once.
  useEffect(() => {
    if (!on || !name) return;
    let cancelled = false;
    fetch(`${BASE}/api/assessments?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setHasRated(((d.assessments ?? []).length) > 0); })
      .catch(() => { if (!cancelled) setHasRated(false); });
    return () => { cancelled = true; };
  }, [on, name]);

  // Show only once we know the player hasn't rated; null = still loading.
  if (!on || !name || dismissed || hasRated !== false) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className="glass-card p-4" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 24, color: 'var(--accent, #22c55e)', flexShrink: 0 }}>
        trending_up
      </span>
      <button
        type="button"
        onClick={onOpen}
        style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0, fontWeight: 600, lineHeight: 1.3 }}>
          {signedUp ? t('skillDiscovery.titleSignedUp') : t('skillDiscovery.title')}
        </p>
        <p style={{ fontSize: 13, color: 'var(--accent, #22c55e)', margin: '2px 0 0', fontWeight: 600 }}>
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
        <span className="material-icons" style={{ fontSize: 16, color: 'var(--text-muted)' }}>close</span>
      </button>
    </div>
  );
}
