'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import StatusBadge from '@/components/primitives/StatusBadge';
import LockedCard, { PreviewRow, useSignInLink } from './LockedCard';
import { useCatalog } from './useCatalog';
import type { UseGear } from './useGear';
import type { UseGearPicks } from './useGearPicks';
import type { UseClubGear } from './useClubGear';
import { gearFailureMessage } from '@/lib/gearFailureMessage';
import {
  blankStringPairing,
  clubOthers,
  indexCatalog,
  racketFeelLine,
  racketSpecLine,
  setupLines,
  stringSpecLine,
  type SetupCategory,
} from '@/lib/gearSetup';
import type { GearItem } from '@/lib/types';

export interface GearSetupCardProps {
  activeName: string | null;
  /** The register's single `UseGear` — never a second instance (see `GearRegister`). */
  gear: UseGear;
  /** The register's single recommend reader — the blank strings line's pairing. */
  picks: UseGearPicks;
  /** The register's single tally read — the club fact on a filled line. */
  club: UseClubGear;
  /** A line was tapped: name it (blank) or manage it (filled). */
  onOpenLine: (category: SetupCategory) => void;
  /** Opens the share sheet. Offered only once both lines are filled — the
   *  complete card is the thing worth sharing. */
  onShare?: () => void;
  /** Opens the fit questionnaire. Rendered OUTSIDE the error fork and never
   *  disabled: on the day the gear read fails it is the only way to reach the
   *  sheet, and so the only way to clear a stored comfort answer. */
  onOpenFit?: () => void;
  /** The empty tension slot on a string with no recorded tension. Omitted,
   *  the slot is not drawn — a chip that opens nothing is a dead button. */
  onAddTension?: (item: GearItem) => void;
}

/**
 * "Set-up" — the Equipment register as ONE spec card (claude.ai/design
 * "Equipment redesign", Turn 2). Two lines, Racket and Strings, because those
 * are the two the catalog can fill; a line is either a dashed slot that asks
 * to be named or a filled row that earns a club fact.
 *
 * It holds no gear state: the doc, the picks and the tally all arrive as the
 * register's single instances, so adding from a sheet updates this card with
 * no refetch and nothing here can disagree with anything else on screen.
 *
 * Three non-ready states, and none of them draws the lines. An unread card
 * must not read as an empty one — dashed slots over a bag that failed to load
 * invite logging a racket that is already logged.
 */
export default function GearSetupCard({ activeName, gear, picks, club, onOpenLine, onShare, onOpenFit, onAddTension }: GearSetupCardProps) {
  const t = useTranslations('stats.gear');
  const ts = useTranslations('stats.gear.setup');
  const tErr = useTranslations('valueHub');
  const signInLink = useSignInLink();
  const rackets = useCatalog('racket');
  const strings = useCatalog('string');
  const [opError, setOpError] = useState<string | null>(null);

  const catalog = useMemo(
    () => indexCatalog([...rackets.items, ...strings.items]),
    [rackets.items, strings.items],
  );

  if (!activeName) return null;
  if (gear.forbidden) {
    return (
      <LockedCard icon="inventory_2" title={ts('eyebrow')} message={t.rich('kitLocked', { link: signInLink })}>
        <PreviewRow width="60%" />
        <PreviewRow width="45%" />
      </LockedCard>
    );
  }
  if (!gear.loaded) return <CardSkeleton height={200} />;

  const { racket, spares, string, filled } = setupLines(gear.loadError ? null : gear.gear);
  // Club facts only from a tally that actually loaded; an errored or refused
  // tally has no numbers, and the line stands on its spec alone.
  const tally = club.status === 'ready' ? club.entries : null;

  function racketSub(item: GearItem): string | null {
    // A typed-in racket describes itself in the member's own answers.
    const spec = item.catalogId ? racketSpecLine(catalog.get(item.catalogId)) : racketFeelLine(item.feel, (k) => ts(k));
    const others = clubOthers(tally, item);
    return [spec, others ? ts('othersPlay', { count: others }) : null].filter(Boolean).join(' · ') || null;
  }

  function stringSub(item: GearItem): string | null {
    const spec = item.catalogId ? stringSpecLine(catalog.get(item.catalogId), (k) => ts(k)) : null;
    const others = clubOthers(tally, item);
    return [spec, others ? ts('othersPlay', { count: others }) : null].filter(Boolean).join(' · ') || null;
  }

  // The pairing for a BLANK strings line — one rule, shared with the
  // register's tension stand-down (see `tensionOnScreen`).
  const pairing = blankStringPairing({ racket, spares, string, filled }, picks.view.string);
  const pairingText = pairing
    ? (typeof pairing.tensionLbs === 'number'
        ? ts('pairSuggestion', { string: pairing.item.model, lb: pairing.tensionLbs })
        : ts('pairSuggestionNoLb', { string: pairing.item.model }))
    : null;

  async function swapIn(id: string) {
    if (gear.busy) return;
    setOpError(null);
    const res = await gear.activate(id);
    if (!res.ok) setOpError(gearFailureMessage(res.reason, tErr));
  }

  return (
    <div className="glass-card p-5" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div style={{ minWidth: 0 }}>
          <p className="section-label-muted" style={{ margin: 0, fontSize: 'var(--fs-2xs)' }}>{ts('eyebrow')}</p>
          <h3 className="setup-name">{activeName}</h3>
        </div>
        {!gear.loadError && filled < 2 && (
          <StatusBadge>{ts('progress', { filled })}</StatusBadge>
        )}
        {!gear.loadError && filled === 2 && onShare && (
          <button type="button" className="setup-share-btn" onClick={onShare}>
            <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-sm)' }}>ios_share</span>
            {ts('share')}
          </button>
        )}
      </div>

      {gear.loadError ? (
        <ErrorState
          message={t('kitError')}
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={gear.reload}>
              {t('retry')}
            </button>
          }
        />
      ) : (
        <>
          <div className="setup-lines">
            {/* Racket */}
            <button
              type="button"
              className={`setup-line${racket ? '' : ' setup-line--blank'}`}
              onClick={() => onOpenLine('racket')}
              disabled={!gear.online}
            >
              <span className="setup-line-label">{t('catRacket')}</span>
              <span className="setup-line-body">
                <span className="setup-line-value">{racket ? racket.label : ts('tapToName')}</span>
                {racket && racketSub(racket) && <span className="setup-line-sub">{racketSub(racket)}</span>}
              </span>
              {racket
                ? <StatusBadge>{ts('inPlay')}</StatusBadge>
                : <EditGlyph />}
            </button>

            {/* Strings. A hybrid is still ONE line: mains and crosses stacked,
                each with its own figure, and the whole line opens the sheet
                where both tensions are set. */}
            {string?.crosses ? (
              <button type="button" className="setup-line" onClick={() => onOpenLine('string')} disabled={!gear.online}>
                <span className="setup-line-label">{t('catString')}</span>
                <span className="setup-line-body setup-line-pair">
                  {([
                    ['mains', string.label, string.tensionLbs],
                    ['crosses', string.crosses.label, string.crosses.tensionLbs],
                  ] as const).map(([role, name, lbs]) => (
                    <span key={role} className="setup-line-pair-row">
                      <span className="setup-line-role">{ts(role)}</span>
                      <span className="setup-line-value">{name}</span>
                      {typeof lbs === 'number' && (
                        <span className="setup-tension">
                          <span key={lbs} className="setup-tension-value animate-count-tick">{lbs}</span>
                          <span className="setup-tension-unit">{t('lb')}</span>
                        </span>
                      )}
                    </span>
                  ))}
                </span>
              </button>
            ) : string && !(typeof string.tensionLbs === 'number') && onAddTension ? (
              /* A div, not a button, when filled with a tension slot: the slot
                 is its own button and buttons do not nest. */
              <div className="setup-line">
                <button
                  type="button"
                  onClick={() => onOpenLine('string')}
                  disabled={!gear.online}
                  className="setup-line-hit"
                >
                  <span className="setup-line-label">{t('catString')}</span>
                  <span className="setup-line-body">
                    <span className="setup-line-value">{string.label}</span>
                    {stringSub(string) && <span className="setup-line-sub">{stringSub(string)}</span>}
                  </span>
                </button>
                <button type="button" className="setup-chip-dashed" onClick={() => onAddTension(string)} disabled={gear.busy}>
                  {ts('addLb')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`setup-line${string ? '' : ' setup-line--blank'}`}
                onClick={() => onOpenLine('string')}
                disabled={!gear.online}
              >
                <span className="setup-line-label">{t('catString')}</span>
                <span className="setup-line-body">
                  <span className="setup-line-value">{string ? string.label : ts('tapToName')}</span>
                  {string && stringSub(string) && <span className="setup-line-sub">{stringSub(string)}</span>}
                  {!string && pairingText && <span className="setup-line-sub setup-line-sub--accent">{pairingText}</span>}
                </span>
                {string && typeof string.tensionLbs === 'number' ? (
                  <span className="setup-tension">
                    {/* Keyed: a just-saved tension ticks in, instead of the
                        number silently being different when the sheet closes. */}
                    <span key={string.tensionLbs} className="setup-tension-value animate-count-tick">{string.tensionLbs}</span>
                    <span className="setup-tension-unit">{t('lb')}</span>
                  </span>
                ) : !string ? (
                  <EditGlyph accent={!!pairingText} />
                ) : null}
              </button>
            )}

            {/* Spares — a line each, never a nested list. "Swap in" moves the
                In play pill; it is the whole of managing a bag of more than one
                from the card itself. */}
            {spares.map((spare) => (
              <div key={spare.id} className="setup-line">
                <span className="setup-line-label">{ts('spare')}</span>
                <span className="setup-line-body">
                  <span className="setup-line-value setup-line-spare">{spare.label}</span>
                </span>
                <button
                  type="button"
                  className="setup-link"
                  onClick={() => { void swapIn(spare.id); }}
                  disabled={gear.busy}
                  aria-label={`${ts('swapIn')} — ${spare.label}`}
                >
                  {ts('swapIn')}
                </button>
              </div>
            ))}
          </div>

          {filled === 0 && (
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-normal)', color: 'var(--text-secondary)' }}>
              {ts('arriveHint')}
            </p>
          )}

          {opError && <ErrorState message={opError} />}
        </>
      )}

      {onOpenFit && (
        <button type="button" className="setup-link" onClick={onOpenFit} style={{ alignSelf: 'flex-start', color: 'var(--text-secondary)' }}>
          {t('fitTitle')}
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-sm)', verticalAlign: 'middle' }}>chevron_right</span>
        </button>
      )}
    </div>
  );
}

function EditGlyph({ accent = false }: { accent?: boolean }) {
  return (
    <span
      className="material-icons"
      aria-hidden="true"
      style={{ fontSize: 'var(--icon-md)', color: accent ? 'var(--accent)' : 'var(--text-muted)', alignSelf: 'center' }}
    >
      edit
    </span>
  );
}
