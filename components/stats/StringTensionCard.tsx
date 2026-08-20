'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import { recommendTension, formatForToggle, MIN_LB, MAX_LB, type PlayFormat } from '@/lib/tension';

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
 */
export interface StringTensionCardProps {
  activeName: string | null;
}

export default function StringTensionCard({ activeName }: StringTensionCardProps) {
  const t = useTranslations('stats.gear');
  const [level, setLevel] = useState<number | null>(null);
  const [format, setFormat] = useState<PlayFormat>('doubles');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!activeName) return;
    const n = encodeURIComponent(activeName);
    let live = true;
    const get = (url: string) =>
      fetch(`${BASE}${url}`, { cache: 'no-store' }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      );

    Promise.allSettled([get(`/api/stats/level?name=${n}`), get(`/api/equipment/gear?name=${n}`)]).then(
      ([lvl, gear]) => {
        if (!live) return;
        if (lvl.status === 'fulfilled') {
          const raw = lvl.value?.level?.level;
          setLevel(typeof raw === 'number' ? raw : null);
        }
        if (gear.status === 'fulfilled') {
          const stored = gear.value?.gear?.playFormat as PlayFormat | undefined;
          if (stored) setFormat(stored);
        }
        setReady(true);
      },
    );
    return () => {
      live = false;
    };
  }, [activeName]);

  const advice = recommendTension(level, format);

  // No level, or still resolving — render nothing rather than a placeholder
  // number. There is no honest skeleton for "we have no advice".
  if (!activeName || !ready || !advice) return null;

  const selected = formatForToggle(format);

  const pick = (next: 'singles' | 'doubles') => {
    setFormat(next);
    // Write through so the recommender and this card agree next time. Failure
    // is silent by design: the number on screen already updated, and the
    // preference is not something the member is waiting on.
    fetch(`${BASE}/api/equipment/gear`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: activeName, playFormat: next }),
    }).catch(() => {});
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
