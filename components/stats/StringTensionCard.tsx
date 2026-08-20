'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import { recommendTension, formatForToggle, MIN_LB, MAX_LB, type PlayFormat } from '@/lib/tension';
import type { UseGear } from './useGear';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * String tension advice, derived from the member's level and format.
 *
 * The card DOES NOT RENDER without a level. A tension number with nothing
 * behind it looks exactly as authoritative as one with a check-in behind it,
 * and someone would go and get their racket strung to it.
 *
 * The number is framed as advice throughout — an advisory line under the
 * scale, and a reason that names why. Handing over a bare figure would invite
 * it being read as a spec.
 *
 * The format comes from — and is written back through — the register's single
 * `UseGear` object. This card used to run its own `GET /api/equipment/gear`
 * and its own bare PATCH, which made it the fourth independent reader and the
 * second independent writer of one document: toggling here left "Your kit" and
 * the rail scoring against the OLD format until reload. There is deliberately
 * no local copy of `format` — a second source of truth IS the bug.
 */
export interface StringTensionCardProps {
  activeName: string | null;
  gear: UseGear;
  /** D2: true once the string pairing has produced a tension for the member's
   *  actual frame-and-string. This card's number is level-based and frame-
   *  agnostic, so it is the fallback, not a second opinion. */
  suppressed?: boolean;
}

export default function StringTensionCard({ activeName, gear, suppressed }: StringTensionCardProps) {
  const t = useTranslations('stats.gear');
  const [level, setLevel] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  // `ready` gates on the LEVEL read alone. The gear doc only decides which
  // toggle is lit; this card's render/no-render rule has always been "do we
  // have a level", and widening it would hide the card on an unrelated failure.
  useEffect(() => {
    if (!activeName) return;
    let live = true;
    fetch(`${BASE}/api/stats/level?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const raw = d?.level?.level;
        setLevel(typeof raw === 'number' ? raw : null);
        setReady(true);
      })
      .catch(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, [activeName]);

  const format = (gear.gear?.playFormat ?? 'doubles') as PlayFormat;
  const advice = recommendTension(level, format);

  // No level, or still resolving — render nothing rather than a placeholder
  // number. There is no honest skeleton for "we have no advice".
  // D2: the string pairing produced a number for this exact frame-and-string,
  // which beats round(21 + level). Stand down rather than offer the member a
  // second, less specific answer to the same question.
  if (suppressed) return null;

  if (!activeName || !ready || !advice) return null;

  const selected = formatForToggle(format);

  // Writes through the single owner so the recommender, the rail and this card
  // all agree immediately. Failure is silent by design: the preference is not
  // something the member is waiting on, and `useGear` leaves the previous value
  // in place rather than showing one the server never took.
  const pick = (next: 'singles' | 'doubles') => {
    void gear.setPrefs({ playFormat: next });
  };

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="science" title={t('tensionTitle')} subtitle={t('tensionSubtitle')} />

      <div className="segment-control flex w-full">
        {(['doubles', 'singles'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => pick(f)}
            disabled={gear.busy}
            aria-current={selected === f ? 'true' : undefined}
            className={`flex-1 flex items-center justify-center fs-sm transition-all ${
              selected === f ? 'segment-tab-active' : 'segment-tab-inactive'
            }`}
          >
            {t(f)}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 'var(--space-2)' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-stat-xl)',
            fontWeight: 700,
            color: 'var(--text-primary)',
            lineHeight: 1,
          }}
        >
          {advice.lb}
        </span>
        <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', fontWeight: 600 }}>{t('lb')}</span>
      </div>

      <div style={{ position: 'relative', margin: '0 8px' }}>
        <div
          style={{
            height: 8,
            borderRadius: 'var(--radius-pill)',
            background:
              'linear-gradient(90deg, color-mix(in srgb, var(--sev-low-text) 40%, transparent), color-mix(in srgb, var(--accent) 50%, transparent), color-mix(in srgb, var(--accent-amber) 50%, transparent))',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -4,
            left: `${advice.position * 100}%`,
            transform: 'translateX(-50%)',
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--text-primary)',
            boxShadow: 'var(--glass-shadow)',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
          {t('scaleLow')}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
          {t('scaleHigh')}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 'var(--fs-base)', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {t(
          advice.reasonKey === 'lowLevel'
            ? 'tensionLowLevel'
            : advice.reasonKey === 'midLevel'
              ? 'tensionMidLevel'
              : 'tensionHighLevel',
        )}
      </p>
      <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('tensionAdvisory')}</p>
    </div>
  );
}

export { MIN_LB, MAX_LB };
