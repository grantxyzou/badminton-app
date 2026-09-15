'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import Racket3D from './Racket3D';
import { racketLook, racketSrc } from '@/lib/racketLook';
import { modelInputs } from '@/lib/racketCustom';
import type { CatalogItem } from '@/lib/types';

/**
 * A catalog racket in 3D, as the model comes — for a frame the member does not
 * own. Their own racket opens `RacketLookSheet` instead, which dresses it.
 */
export default function FrameViewSheet({ open, onClose, row }: { open: boolean; onClose: () => void; row: CatalogItem }) {
  const t = useTranslations('stats.gear.setup');
  const tRecovery = useTranslations('recovery');
  const inputs = useMemo(() => modelInputs(racketLook(row.id), {}), [row.id]);
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={row.model}>
      <BottomSheetHeader>
        <div style={{ minWidth: 0 }}>
          <p className="setup-eyebrow">{row.brand}</p>
          <span className="fs-stat" style={{ display: 'block', marginTop: 'var(--space-05)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.015em' }}>
            {row.model}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }}>
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <Racket3D look={inputs.look} tweaks={inputs.tweaks} fallbackSrc={racketSrc(row.id)} label={t('look3dLabel', { racket: row.model })} />
      </BottomSheetBody>
    </BottomSheet>
  );
}
