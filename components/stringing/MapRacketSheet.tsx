'use client';

import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import type { FitRacketChoice } from '@/lib/types';

/**
 * "Change" on the strings map's "For your <racket>" strip
 * (docs/plans/map-racket-choice.md; Grant, on the canvas, 2026-11-18: "this
 * should allow user change rackets"): the member's own rackets, the one the
 * map is matched to marked, and a tap matches the map to another.
 *
 * A menu sheet: every row is its own action, so there is no footer button.
 * The sheet stays open while the picked racket's answer is read, and a
 * failed read says so here, with the map left on the racket it was on.
 *
 * It changes what the MAP is matched to, on this phone, and nothing else:
 * the racket in play is set on Stats, and is only labelled here.
 */
export default function MapRacketSheet({
  open,
  onClose,
  rackets,
  current,
  pending,
  failed,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  rackets: FitRacketChoice[];
  /** The bag item id the map is matched to now. */
  current: string | null;
  /** The bag item id whose answer is being read, or null. */
  pending: string | null;
  /** The last pick's read failed. */
  failed: boolean;
  onPick: (id: string) => void;
}) {
  const t = useTranslations('home.stringing.offer');
  const online = useOnline();
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('racketSheetTitle')}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('close')}>
        <span className="bpm-h3" style={{ margin: 0 }}>{t('racketSheetTitle')}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col gap-3">
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('racketSheetHint')}</p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('racketSheetTitle')}>
            {rackets.map((r) => {
              const selected = r.id === current;
              const busy = r.id === pending;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-busy={busy || undefined}
                  // Offline, a pick could only fail: the banner says why.
                  disabled={!online || (pending !== null && !busy)}
                  onClick={() => (selected ? onClose() : onPick(r.id))}
                  className={`cc-choice${busy ? ' motion-busy' : ''}`}
                  style={{ alignItems: 'center' }}
                >
                  <span
                    className="material-icons icon-md"
                    aria-hidden="true"
                    style={{ flex: 'none', color: selected ? 'var(--accent)' : 'var(--text-muted)' }}
                  >
                    {selected ? 'radio_button_checked' : 'radio_button_unchecked'}
                  </span>
                  <span className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: 'var(--space-05)' }}>
                    <span className="fs-md" style={{ fontWeight: 600, color: selected ? 'var(--accent)' : 'var(--text-primary)' }}>{r.name}</span>
                    {r.inPlay && <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('racketInPlay')}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {/* The server did not answer: not the member's mistake, so not red. */}
          {failed && <p className="field-warn" role="alert" style={{ margin: 0 }}>{t('racketPickError')}</p>}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
