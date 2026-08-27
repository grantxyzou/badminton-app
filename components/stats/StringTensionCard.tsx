'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import { recommendTension, formatForToggle, MIN_LB, MAX_LB, type PlayFormat } from '@/lib/tension';
import type { UseGear } from './useGear';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * String tension advice, derived from the member's level and format.
 *
 * The card DOES NOT RENDER a number without a level AND a known play format. A
 * tension figure with nothing behind it looks exactly as authoritative as one
 * with a check-in behind it, and someone would go and get their racket strung
 * to it. "Nothing behind it" includes a FAILED read, not just a missing one —
 * so a member who has never checked in still gets silence, while a read that
 * broke gets a visible failure. Those two used to render identically.
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
  const tStats = useTranslations('stats');
  // The bag-write failure vocabulary, shared with both gear sheets so one
  // refusal cannot be described two different ways on one tab.
  const tGearErr = useTranslations('valueHub');
  const [level, setLevel] = useState<number | null>(null);
  // Was a bare `ready` boolean, which merged three different worlds: read
  // succeeded with a level, read succeeded with no level, and read FAILED.
  // The last two both left `level` null, so a failed read vanished the card
  // exactly like a member who has never checked in.
  const [levelStatus, setLevelStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  // A refused format write. Deliberately NOT a local copy of `format` — the
  // docstring above is right that a second source of truth is the bug. This
  // holds only the reason the stored value did not move.
  const [prefError, setPrefError] = useState<string | null>(null);

  // `levelStatus` gates on the LEVEL read alone. The gear doc only decides
  // which toggle is lit; this card's render/no-render rule has always been "do
  // we have a level", and widening it would hide the card on an unrelated
  // failure.
  useEffect(() => {
    if (!activeName) return;
    let live = true;
    fetch(`${BASE}/api/stats/level?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => {
        // The route is owner-or-admin gated. 403 means this device does not
        // own the name — refreshing cannot fix it, signing in can.
        if (r.status === 403) return Promise.reject(new Error('forbidden'));
        return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
      })
      .then((d) => {
        if (!live) return;
        const raw = d?.level?.level;
        setLevel(typeof raw === 'number' ? raw : null);
        setLevelStatus('ready');
      })
      .catch((e: Error) => {
        if (!live) return;
        setLevelStatus(e?.message === 'forbidden' ? 'forbidden' : 'error');
      });
    return () => {
      live = false;
    };
  }, [activeName]);

  const format = (gear.gear?.playFormat ?? 'doubles') as PlayFormat;
  const advice = recommendTension(level, format);

  /** Card shell carrying one legible-fail line instead of a number. */
  const failed = (message: string) => (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="science" title={t('tensionTitle')} subtitle={t('tensionSubtitle')} />
      <ErrorState message={message} />
    </div>
  );

  // D2: the string pairing produced a number for this exact frame-and-string,
  // which beats round(21 + level). Stand down rather than offer the member a
  // second, less specific answer to the same question. MUST stay the first
  // return — a suppressed card renders nothing, errors included.
  if (suppressed) return null;
  if (!activeName) return null;

  // Order is deliberate, and each branch answers a different question.
  if (levelStatus === 'loading') return null;
  if (levelStatus === 'forbidden') return failed(tStats('signInAgain'));
  if (levelStatus === 'error') return failed(t('tensionError'));

  // Read succeeded and the member genuinely has no level yet: render nothing,
  // as before. This is the one honest silence and must not become an error.
  if (level === null || !advice) return null;

  // We HAVE a level but the gear read failed, so `playFormat` is unknown.
  // Falling back to 'doubles' lit the Doubles segment as though it were the
  // member's stored preference and printed a doubles number at a singles
  // player — a recommendation with nothing behind it, which this card's
  // docstring forbids. `useGear` sets `loadError` for exactly this.
  if (gear.loadError) return failed(t('tensionError'));

  const selected = formatForToggle(format);

  // Writes through the single owner so the recommender, the rail and this card
  // all agree immediately.
  //
  // This used to be `void gear.setPrefs(...)`, justified in a comment as
  // "silent by design: the preference is not something the member is waiting
  // on". That was wrong, and visibly so: the headline number below IS
  // `recommendTension(level, format)`. Tapping Singles is the member asking
  // for a different number. When the write is refused, `useGear` correctly
  // leaves the stored value alone — so the segment snaps back to Doubles and
  // the number does not move, which is a dead control with no explanation.
  // The silence is only defensible for a preference nothing on screen depends
  // on, and this card is built out of exactly this one.
  const pick = async (next: 'singles' | 'doubles') => {
    setPrefError(null);
    const res = await gear.setPrefs({ playFormat: next });
    if (res.ok) return;
    if (res.reason === 'unauthorized') setPrefError(tStats('signInAgain'));
    else if (res.reason === 'member_not_found') setPrefError(tGearErr('bagMemberMissing'));
    else setPrefError(t('tensionError'));
  };

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="science" title={t('tensionTitle')} subtitle={t('tensionSubtitle')} />

      <div className="segment-control flex w-full">
        {(['doubles', 'singles'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => { void pick(f); }}
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

      {/* Inline, not `failed(...)`: the recommendation itself is still valid
          and still worth showing — only the member's requested CHANGE to it
          was refused. Replacing the whole card would throw away good data. */}
      {prefError && <ErrorState message={prefError} />}

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

      <div style={{ position: 'relative', margin: '0 var(--space-3)' }}>
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

      <p style={{ margin: '0', fontSize: 'var(--fs-base)', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {t(
          advice.reasonKey === 'lowLevel'
            ? 'tensionLowLevel'
            : advice.reasonKey === 'midLevel'
              ? 'tensionMidLevel'
              : 'tensionHighLevel',
        )}
      </p>
      <p style={{ margin: '0', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('tensionAdvisory')}</p>
    </div>
  );
}

export { MIN_LB, MAX_LB };
