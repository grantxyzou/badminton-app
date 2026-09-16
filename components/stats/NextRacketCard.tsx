'use client';

import { useTranslations } from 'next-intl';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import { racketSrc } from '@/lib/racketLook';
import type { UseGear } from './useGear';
import type { UseGearPicks } from './useGearPicks';
import { setupLines } from '@/lib/gearSetup';
import { priceCadPoint } from '@/lib/catalogPrice';

export interface NextRacketCardProps {
  gear: UseGear;
  picks: UseGearPicks;
  /** Opens the pick's detail (`GearPickSheet`). */
  onOpen: () => void;
  /** The questionnaire, for a pick parked on `needsFit`. */
  onOpenFit: () => void;
}

/**
 * "Where you'd go next" (claude.ai/design "Equipment redesign", screen 06).
 *
 * The racket engine's answer once a racket is on the card: it excludes what
 * the member owns, so its pick is a NEXT racket, and its headline reason
 * already speaks relative to the one in play ("A step up in power from your
 * Air Force 79"). This is the rail's racket card given the one place in the
 * redesign it still belongs.
 *
 * Renders nothing until there IS a racket in play — before that the engine's
 * pick is the add sheet's "From your check-in" suggestion, and saying it twice
 * on one screen would be two answers to one question. A parked engine with no
 * door (no catalog, no engine) has nothing to say and says nothing; one parked
 * on the fit questions is a door; a failure is a failure.
 */
export default function NextRacketCard({ gear, picks, onOpen, onOpenFit }: NextRacketCardProps) {
  const t = useTranslations('stats.gear.setup');
  const tGear = useTranslations('stats.gear');
  if (!gear.loaded || gear.loadError || picks.refused) return null;
  const { racket } = setupLines(gear.gear);
  if (!racket) return null;

  const { status, pick } = picks.view.racket;
  if (status === 'loading') return <CardSkeleton height={176} />;

  if (status === 'error') {
    return (
      <div className="glass-card p-5" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <p className="setup-eyebrow">{t('nextTitle')}</p>
        <ErrorState
          message={tGear('pickError')}
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => picks.retry('racket', status)}>
              {tGear('retry')}
            </button>
          }
        />
      </div>
    );
  }

  if (status === 'parked' || !pick) {
    if (picks.parkReasons.racket !== 'needsFit') return null;
    return (
      <button type="button" className="glass-card p-5 setup-next" onClick={onOpenFit}>
        <p className="setup-eyebrow">{t('nextTitle')}</p>
        <span className="setup-next-row">
          <span className="setup-next-body">
            <span className="fs-md" style={{ color: 'var(--text-primary)' }}>{tGear('railRacketFit')}</span>
            <span className="fs-sm" style={{ color: 'var(--accent)' }}>{tGear('railTapToFit')}</span>
          </span>
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>chevron_right</span>
        </span>
      </button>
    );
  }

  // The engine's own headline, which is already relative to the racket in
  // play; the price follows it, as in the design.
  const headline = (pick.reasons[0] ?? '').replace(/\.\s*$/, '');
  const sub = [headline || null, priceCadPoint(pick.item) !== null ? `~$${priceCadPoint(pick.item)}` : null].filter(Boolean).join(' · ');

  return (
    <div className="glass-card p-5" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <p className="setup-eyebrow">{t('nextTitle')}</p>
      <button type="button" className="setup-next-row" onClick={onOpen} aria-label={`${pick.item.brand} ${pick.item.model} — ${t('nextOpen')}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the model's drawing as an SVG data URL; see lib/racketLook.ts. */}
        <img src={racketSrc(pick.item.id)} alt="" className="setup-next-img" width={240} height={624} loading="lazy" decoding="async" />
        <span className="setup-next-body">
          <span className="fs-lg" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{pick.item.model}</span>
          {sub && <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{sub}</span>}
        </span>
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>chevron_right</span>
      </button>
      <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>{t('nextNote')}</p>
    </div>
  );
}
