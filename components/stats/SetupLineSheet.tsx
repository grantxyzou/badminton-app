'use client';

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import TensionField, { ratedRange } from './TensionField';
import { useClubTension } from './useClubTension';
import RacketFeelChips from './RacketFeelChips';
import { useCatalog } from './useCatalog';
import type { GearResult, UseGear } from './useGear';
import { gearFailureMessage } from '@/lib/gearFailureMessage';
import { catalogSpecRows } from '@/lib/catalogSpecs';
import { racketFeelLine, racketRowSpec, setupLines, stringSpecLine, type SetupCategory } from '@/lib/gearSetup';
import type { GearItem, RacketFeel } from '@/lib/types';

export interface SetupLineSheetProps {
  open: boolean;
  onClose: () => void;
  category: SetupCategory;
  gear: UseGear;
  /** "Change the model" / "Change the string" — the add sheet, as the one in play. */
  onChange: () => void;
  /** "Add another racket as a spare" — the add sheet, NOT as the one in play. */
  onAddSpare: () => void;
  /** "See it in 3D" — the racket's own look sheet (swaps with this one). */
  onViewLook?: (item: GearItem, title: string) => void;
  /** The racket's own page (NEXT_PUBLIC_FLAG_GEAR_PAGES). Only a catalog racket has one. */
  onViewFrame?: (catalogId: string) => void;
}

/**
 * One filled line's own sheet (claude.ai/design "Equipment redesign", screen
 * 05). It is about THAT line only — no catalog stacked under a management
 * list, which is the arrangement the old kit card and `GearSheet` kept
 * growing back into.
 *
 * Retire is not here: Grant left it out on 2026-09-14. Remove stays, because it
 * is the only way to undo a wrong add, and it asks once before it acts.
 *
 * Mount with a fresh `key` per opening; its state describes one visit.
 */
export default function SetupLineSheet({ open, onClose, category, gear, onChange, onAddSpare, onViewLook, onViewFrame }: SetupLineSheetProps) {
  const t = useTranslations('stats.gear.setup');
  const tGear = useTranslations('stats.gear');
  const tHub = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const catalog = useCatalog(category);
  const [specsOpen, setSpecsOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [tension, setTension] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Feel answers edited on this visit; null = untouched, so the stored ones show. */
  const [feel, setFeel] = useState<RacketFeel | null>(null);

  const lines = setupLines(gear.loadError ? null : gear.gear);
  const item = category === 'racket' ? lines.racket : lines.string;
  // The string's frame: the racket on the card.
  const racketCatalog = useCatalog('racket');
  const frameId = category === 'string' ? lines.racket?.catalogId ?? null : null;
  const frameRow = frameId ? racketCatalog.items.find((c) => c.id === frameId) : undefined;
  const clubTension = useClubTension(frameId);
  const row = item?.catalogId ? catalog.items.find((c) => c.id === item.catalogId) : undefined;

  const label = category === 'racket' ? tGear('catRacket') : tGear('catString');
  const title = row?.model ?? item?.label ?? label;
  // A racket typed by name has no catalog row; its only spec is what the
  // member said about it.
  const typedRacket = category === 'racket' && !!item && !item.catalogId;
  const spec = row
    ? [row.brand, category === 'racket' ? racketRowSpec(row) : stringSpecLine(row, (k) => t(k))].filter(Boolean).join(' · ')
    : typedRacket ? racketFeelLine(item?.feel, (k) => t(k)) : null;
  const shownFeel = feel ?? item?.feel ?? {};
  const feelChanged = feel !== null && feelKey(feel) !== feelKey(item?.feel ?? {});
  const specRows = row ? catalogSpecRows(row) : [];

  async function run(op: () => Promise<GearResult>, after?: () => void) {
    if (gear.busy) return;
    setError(null);
    const res = await op();
    if (!res.ok) { setError(gearFailureMessage(res.reason, tHub)); return; }
    after?.();
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title}>
      <BottomSheetHeader>
        <div style={{ minWidth: 0 }}>
          <p className="setup-eyebrow">{label}</p>
          <span
            className="fs-stat"
            style={{ display: 'block', marginTop: 'var(--space-05)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.015em' }}
          >
            {title}
          </span>
          {spec && <span className="fs-sm" style={{ display: 'block', marginTop: 'var(--space-05)', color: 'var(--text-secondary)' }}>{spec}</span>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {!item ? (
            // The line emptied under the sheet (removed from another device, or
            // the read failed). Say so rather than offering actions on nothing.
            <ErrorState message={tGear('kitError')} />
          ) : (
            <div className="setup-actions">
              {category === 'racket' ? (
                <>
                  <div className="setup-action setup-action--current">
                    <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--accent)' }}>check</span>
                    <span className="setup-action-label">{t('theOneYouPlay')}</span>
                  </div>
                  <ActionRow icon="swap_horiz" label={t('changeModel')} onClick={onChange} disabled={!gear.online} />
                  {onViewFrame && item.catalogId && <ActionRow icon="fact_check" label={t('viewFrame')} onClick={() => onViewFrame(item.catalogId!)} />}
                  {onViewLook && <ActionRow icon="sports_tennis" label={t('viewIn3d')} onClick={() => onViewLook(item, title)} />}
                  <ActionRow icon="add" label={t('addSpare')} onClick={onAddSpare} disabled={!gear.online} />
                </>
              ) : (
                <>
                  <div className="setup-action setup-action--stack">
                    <span className="tension-field-label">
                      <span className="setup-action-label">{t('tension')}</span>
                      <button
                        type="button"
                        className="setup-link"
                        disabled={tension === null || tension === item.tensionLbs || gear.busy || !gear.online}
                        onClick={() => { if (tension !== null) void run(() => gear.setTension(item, tension), () => setTension(null)); }}
                      >
                        {t('saveTension')}
                      </button>
                    </span>
                    <TensionField
                      label={t('tension')}
                      value={tension ?? item.tensionLbs ?? null}
                      onChange={setTension}
                      rated={ratedRange(frameRow?.attributes)}
                      club={clubTension.band}
                      clubStatus={frameId ? clubTension.status : undefined}
                      disabled={gear.busy || !gear.online}
                    />
                  </div>
                  <ActionRow icon="swap_horiz" label={t('changeString')} onClick={onChange} disabled={!gear.online} />
                </>
              )}

              {confirmRemove ? (
                <div className="setup-action" role="group" aria-label={t('removeConfirm', { label: item.label })}>
                  <span className="setup-action-label" style={{ color: 'var(--text-primary)' }}>{t('removeConfirm', { label: item.label })}</span>
                  <button type="button" className="setup-link" style={{ color: 'var(--sev-crit-text)' }} disabled={gear.busy || !gear.online}
                    onClick={() => { void run(() => gear.remove(item.id), onClose); }}>
                    {t('removeYes')}
                  </button>
                  <button type="button" className="setup-link" style={{ color: 'var(--text-secondary)' }} onClick={() => setConfirmRemove(false)}>
                    {t('cancel')}
                  </button>
                </div>
              ) : (
                <ActionRow icon="delete_outline" label={t('remove')} onClick={() => setConfirmRemove(true)} disabled={!gear.online} />
              )}
            </div>
          )}

          {typedRacket && item && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} aria-label={t('feelTitle')}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
                <span className="fs-md" style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 600 }}>{t('feelTitle')}</span>
                <button
                  type="button"
                  className="setup-link"
                  disabled={!feelChanged || gear.busy || !gear.online}
                  onClick={() => { if (feel) void run(() => gear.setFeel(item.id, feel), () => setFeel(null)); }}
                >
                  {t('saveFeel')}
                </button>
              </span>
              <span className="fs-sm" style={{ color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{t('feelHelp')}</span>
              <RacketFeelChips value={shownFeel} onChange={setFeel} disabled={gear.busy || !gear.online} />
            </section>
          )}

          {error && <ErrorState message={error} />}

          {specRows.length > 0 && (
            <section style={{ borderTop: '1px solid var(--divider)', paddingTop: 'var(--space-4)' }}>
              <button
                type="button"
                onClick={() => setSpecsOpen((v) => !v)}
                aria-expanded={specsOpen}
                aria-controls="setup-line-specs"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
                  width: '100%', background: 'transparent', border: 'none', padding: '0', cursor: 'pointer',
                  color: 'inherit', textAlign: 'left',
                }}
              >
                <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{tGear('pickSheetFullSpecs')}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span className="fs-base" style={{ color: 'var(--text-muted)' }}>{specRows.length}</span>
                  <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>
                    {specsOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </span>
              </button>
              {specsOpen && (
                <dl id="setup-line-specs" style={{ margin: 'var(--space-4) 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 'var(--space-5)', rowGap: 'var(--space-2)' }}>
                  {specRows.map((r) => (
                    <Fragment key={r.labelKey}>
                      <dt className="fs-sm" style={{ color: 'var(--text-muted)' }}>{tGear(r.labelKey)}</dt>
                      <dd className="fs-sm" style={{ margin: '0', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.value}</dd>
                    </Fragment>
                  ))}
                </dl>
              )}
            </section>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}

/** Answers in a fixed order with gaps dropped, so two feels compare by value. */
function feelKey(f: RacketFeel): string {
  return [f.balance ?? '', f.flex ?? '', f.weight ?? ''].join('|');
}

function ActionRow({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="setup-action" onClick={onClick} disabled={disabled}>
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>{icon}</span>
      <span className="setup-action-label">{label}</span>
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>chevron_right</span>
    </button>
  );
}
