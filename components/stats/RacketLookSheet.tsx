'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '../BottomSheet';
import Racket3D from './Racket3D';
import type { UseGear } from './useGear';
import { gearFailureMessage } from '@/lib/gearFailureMessage';
import { racketLook, racketSrc } from '@/lib/racketLook';
import { LOOK_PATTERNS, LOOK_SHAPES, SWATCHES, modelInputs, type ItemLook } from '@/lib/racketCustom';
import type { GearItem } from '@/lib/types';

export interface RacketLookSheetProps {
  open: boolean;
  onClose: () => void;
  gear: UseGear;
  item: GearItem;
  title: string;
}

const PATTERN_KEY: Record<(typeof LOOK_PATTERNS)[number], string> = {
  shoulder: 'patternShoulder', tips: 'patternTips', chevron: 'patternChevron', crown: 'patternCrown', plain: 'patternPlain',
};
const SHAPE_KEY: Record<(typeof LOOK_SHAPES)[number], string> = {
  isometric: 'shapeIsometric', oval: 'shapeOval', boxy: 'shapeBoxy',
};

function sameLook(a: ItemLook, b: ItemLook): boolean {
  const keys = ['string', 'wrap', 'frame', 'pattern', 'shape'] as const;
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/**
 * The racket in 3D, and the two things a member really changes about it: the
 * string colour and the overgrip (Grant, 2026-09-14). A racket typed in by name
 * also takes frame colour, paint and head shape — nobody else can say what it
 * looks like. Every tap previews on the live model; the choice is written once,
 * on Done. Closing (the X, Escape) DISCARDS: a way out of a sheet must never
 * depend on a network write succeeding, or a member offline is trapped in it.
 */
export default function RacketLookSheet({ open, onClose, gear, item, title }: RacketLookSheetProps) {
  const t = useTranslations('stats.gear.setup');
  const tHub = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const [look, setLook] = useState<ItemLook>(item.look ?? {});
  const [error, setError] = useState<string | null>(null);
  const typed = !item.catalogId;

  const base = racketLook(item.catalogId);
  const inputs = useMemo(() => modelInputs(base, look), [base, look]);

  async function done() {
    if (sameLook(look, item.look ?? {})) { onClose(); return; }
    setError(null);
    const res = await gear.setLook(item.id, look);
    if (!res.ok) { setError(gearFailureMessage(res.reason, tHub)); return; }
    onClose();
  }

  function swatchRow(key: 'string' | 'wrap' | 'frame', label: string, withAuto: boolean) {
    // Strings have no "as it comes" dot: an unchosen string is the model's own
    // white, so that swatch reads as the choice.
    const current = look[key] ?? (withAuto ? null : SWATCHES[key][0]);
    return (
      <div className="look-row" role="radiogroup" aria-label={label}>
        <span className="look-label">{label}</span>
        <span className="look-swatches">
          {withAuto && (
            <button type="button" role="radio" aria-checked={current === null} aria-label={t('lookAuto')}
              className="look-swatch look-swatch--auto" onClick={() => setLook((l) => ({ ...l, [key]: undefined }))} />
          )}
          {SWATCHES[key].map((hex, i) => (
            <button key={hex} type="button" role="radio" aria-checked={current === hex}
              aria-label={t('lookSwatch', { n: i + 1 })}
              className="look-swatch" style={{ background: hex }}
              onClick={() => setLook((l) => ({ ...l, [key]: hex }))} />
          ))}
        </span>
      </div>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title}>
      <BottomSheetHeader>
        <div style={{ minWidth: 0 }}>
          <p className="setup-eyebrow">{t('lookEyebrow')}</p>
          <span className="fs-stat" style={{ display: 'block', marginTop: 'var(--space-05)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.015em' }}>
            {title}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }}>
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <Racket3D look={inputs.look} tweaks={inputs.tweaks} fallbackSrc={racketSrc(item.catalogId)} label={t('look3dLabel', { racket: title })} />
          {swatchRow('string', t('lookString'), false)}
          {swatchRow('wrap', t('lookWrap'), true)}
          {typed && (
            <>
              {swatchRow('frame', t('lookFrame'), true)}
              <div className="look-row" role="radiogroup" aria-label={t('lookPattern')}>
                <span className="look-label">{t('lookPattern')}</span>
                <span className="setup-feel-chips">
                  {LOOK_PATTERNS.map((p) => (
                    <button key={p} type="button" role="radio" className="setup-feel-chip"
                      aria-checked={(look.pattern ?? 'shoulder') === p} aria-pressed={(look.pattern ?? 'shoulder') === p}
                      onClick={() => setLook((l) => ({ ...l, pattern: p }))}>
                      {t(PATTERN_KEY[p])}
                    </button>
                  ))}
                </span>
              </div>
              <div className="look-row" role="radiogroup" aria-label={t('lookShape')}>
                <span className="look-label">{t('lookShape')}</span>
                <span className="setup-feel-chips">
                  {LOOK_SHAPES.map((s) => (
                    <button key={s} type="button" role="radio" className="setup-feel-chip"
                      aria-checked={(look.shape ?? 'isometric') === s} aria-pressed={(look.shape ?? 'isometric') === s}
                      onClick={() => setLook((l) => ({ ...l, shape: s }))}>
                      {t(SHAPE_KEY[s])}
                    </button>
                  ))}
                </span>
              </div>
            </>
          )}
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
            {typed ? t('lookNoteTyped') : t('lookNote')}
          </p>
          {error && <ErrorState message={error} />}
        </div>
      </BottomSheetBody>

      <BottomSheetFooter>
        <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => { void done(); }} disabled={gear.busy || !gear.online}>
          {t('done')}
        </button>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
