'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRevealReady } from '@/components/primitives/Reveal';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import StatusBadge from '@/components/primitives/StatusBadge';
import LockedCard, { PreviewRow, useSignInLink } from './LockedCard';
import { useCatalog } from './useCatalog';
import type { UseGear } from './useGear';
import type { UseGearPicks } from './useGearPicks';
import type { UseClubGear } from './useClubGear';
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
import StringPackImage from '@/components/stringing/StringPackImage';
import { stringPackSrc } from '@/lib/stringPackSrc';
import { racketSrc } from '@/lib/racketLook';
import { STOCK_STRING } from '@/lib/racketCustom';
import { stringOn } from '@/lib/activeRacket';

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
  /** A spare's row was tapped: that racket's own sheet. */
  onOpenSpare?: (itemId: string) => void;
  /** "Add a spare racket": the add sheet, NOT as the one in play. It lived in
   *  the racket's line sheet until 2026-10-19; it is a quiet link in the
   *  card's footer now, beside "Your fit" — an empty spare is an offer, not a
   *  line of gear. Omitted, the link is not drawn. */
  onAddSpare?: () => void;
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
export default function GearSetupCard({ activeName, gear, picks, club, onOpenLine, onOpenSpare, onShare, onOpenFit, onAddTension, onAddSpare }: GearSetupCardProps) {
  const t = useTranslations('stats.gear');
  const ts = useTranslations('stats.gear.setup');
  const signInLink = useSignInLink();
  const rackets = useCatalog('racket');
  const strings = useCatalog('string');

  const catalog = useMemo(
    () => indexCatalog([...rackets.items, ...strings.items]),
    [rackets.items, strings.items],
  );

  // Liquid glass that REFRACTS the racket behind it needs an SVG filter in
  // `backdrop-filter`, which only Chromium draws; WebKit (every iPhone browser)
  // would drop the whole declaration and lose the frost too. So the refraction
  // is switched on only where `navigator.userAgentData` says Chromium, after
  // mount (the server cannot know), and everyone else keeps the frosted glass.
  const [refract, setRefract] = useState(false);
  useEffect(() => { setRefract(typeof navigator !== 'undefined' && 'userAgentData' in navigator); }, []);

  // The Gear register's RevealSlot holds this place on first load.
  useRevealReady(!activeName || gear.loaded);
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

  // The string's spec alone: how many others use it was dropped from the
  // card (Grant, 2026-11-05: "Dont need · 3 others in this group use this
  // string"). "What the club plays" still carries the count.
  function stringSub(item: GearItem): string | null {
    return item.catalogId ? stringSpecLine(catalog.get(item.catalogId), (k) => ts(k)) : null;
  }

  // The pairing for a BLANK strings line — one rule, shared with the
  // register's tension stand-down (see `tensionOnScreen`).
  const pairing = blankStringPairing({ racket, spares, string, filled }, picks.view.string);
  const pairingText = pairing
    ? (typeof pairing.tensionLbs === 'number'
        ? ts('pairSuggestion', { string: pairing.item.model, lb: pairing.tensionLbs })
        : ts('pairSuggestionNoLb', { string: pairing.item.model }))
    : null;


  return (
    <div className={`glass-card p-5 setup-card${refract ? ' setup-card--refract' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* The main racket, close up, across the right half of the card (Grant,
          2026-11-05: "Only for main racket", "bigger more close up and takes
          1.5/3 of the card"). Its pre-rendered picture, clipped by the card
          and faded into it on the left; decorative, so no name and no tap. */}
      {racket && !gear.loadError && (
        <span className="setup-corner" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin pre-rendered WebP; next/image adds nothing here. */}
          <img key={racket.id} src={racketSrc(racket.catalogId)} alt="" width={240} height={624} decoding="async" className="motion-fade" />
        </span>
      )}
      {/* The lens the glass controls bend the racket through (see `refract`). */}
      {racket && refract && (
        <svg className="setup-glass-defs" aria-hidden="true" focusable="false">
          <filter id="setup-refract" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves={2} seed={7} result="lens" />
            <feDisplacementMap in="SourceGraphic" in2="lens" scale={16} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div style={{ minWidth: 0 }}>
          <p className="section-label-muted" style={{ margin: 0, fontSize: 'var(--fs-2xs)' }}>{ts('eyebrow')}</p>
          <h3 className="setup-name">{activeName}</h3>
        </div>
        {!gear.loadError && filled < 2 && (
          <StatusBadge>{ts('progress', { filled })}</StatusBadge>
        )}
        {!gear.loadError && filled === 2 && onShare && (
          <button type="button" className="setup-share-btn setup-glass" onClick={onShare}>
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
            {/* Main racket. No pill on a filled line: the label already says
                which racket this is (Stats canvas, 2026-10-19). */}
            <button
              type="button"
              className={`setup-line${racket ? '' : ' setup-line--blank'}`}
              onClick={() => onOpenLine('racket')}
              disabled={!gear.online}
            >
              <span className="setup-line-label">{ts('mainRacket')}</span>
              <span className="setup-line-body">
                <span className="setup-line-value">{racket ? racket.label : ts('tapToName')}</span>
                {racket && racketSub(racket) && <span className="setup-line-sub">{racketSub(racket)}</span>}
              </span>
              {!racket && <EditGlyph />}
            </button>

            {/* Strings. A hybrid is still ONE line: mains and crosses stacked,
                each with its own figure, and the whole line opens the sheet
                where both tensions are set. */}
            {string?.crosses ? (
              <button type="button" className="setup-line" onClick={() => onOpenLine('string')} disabled={!gear.online}>
                <StringsLabel text={t('catString')} item={string} racket={racket} />
                <span className="setup-line-body setup-line-pair">
                  {([
                    ['mains', string.label, string.tensionLbs],
                    ['crosses', string.crosses.label, string.crosses.tensionLbs],
                  ] as const).map(([role, name, lbs]) => (
                    <span key={role} className="setup-line-pair-row">
                      <span className="setup-line-role">{ts(role)}</span>
                      <span className="setup-line-value">{name}</span>
                      {typeof lbs === 'number' && (
                        <span className="setup-tension setup-glass">
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
                  <StringsLabel text={t('catString')} item={string} racket={racket} />
                  <span className="setup-line-body">
                    <span className="setup-line-value">{string.label}</span>
                    {stringSub(string) && <span className="setup-line-sub">{stringSub(string)}</span>}
                  </span>
                </button>
                <button type="button" className="setup-chip-dashed setup-glass" onClick={() => onAddTension(string)} disabled={gear.busy}>
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
                <StringsLabel text={t('catString')} item={string} racket={racket} />
                <span className="setup-line-body">
                  <span className="setup-line-value">{string ? string.label : ts('tapToName')}</span>
                  {string && stringSub(string) && <span className="setup-line-sub">{stringSub(string)}</span>}
                  {!string && pairingText && <span className="setup-line-sub setup-line-sub--accent">{pairingText}</span>}
                </span>
                {string && typeof string.tensionLbs === 'number' ? (
                  <span className="setup-tension setup-glass">
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
          </div>

          {/* Spares, below a divider (Grant, 2026-11-05: "Racket and String
              should be next to each other then a divider below show spare
              rackets"). The racket and its string are one set-up; a spare is
              a different racket with its own string, so each row says which,
              and opens that racket's own sheet, where it can be swapped in. */}
          {spares.length > 0 && (
            <div className="setup-spares">
              {spares.map((spare) => {
                const on = stringOn(gear.gear, spare);
                const strung = on
                  ? (typeof on.tensionLbs === 'number' ? ts('spareStrungLb', { string: on.label, lb: on.tensionLbs }) : ts('spareStrung', { string: on.label }))
                  : null;
                return (
                  <button
                    key={spare.id}
                    type="button"
                    className="setup-line"
                    onClick={() => onOpenSpare?.(spare.id)}
                    disabled={!gear.online || !onOpenSpare}
                  >
                    <span className="setup-line-label">{ts('spare')}</span>
                    <span className="setup-line-body">
                      <span className="setup-line-value setup-line-spare">{spare.label}</span>
                      {strung && <span className="setup-line-sub">{strung}</span>}
                    </span>
                    <span className="material-icons setup-glass setup-glass-icon" aria-hidden="true">chevron_right</span>
                  </button>
                );
              })}
            </div>
          )}

          {filled === 0 && (
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-normal)', color: 'var(--text-secondary)' }}>
              {ts('arriveHint')}
            </p>
          )}

        </>
      )}

      {/* The footer: two optional extras at one quiet weight. "Add a spare"
          only once there is a racket to be a spare TO, and never over a bag
          that failed to load; "Your fit" ALWAYS, outside the error fork (the
          always-there door rule). */}
      {(onOpenFit || (racket && onAddSpare && !gear.loadError)) && (
        <div className="setup-footer">
          {racket && onAddSpare && !gear.loadError ? (
            <button type="button" className="setup-link setup-footer-link" onClick={onAddSpare} disabled={!gear.online}>
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-sm)' }}>add</span>
              {ts('addSpare')}
            </button>
          ) : <span />}
          {onOpenFit && (
            <button type="button" className="setup-link setup-footer-link" onClick={onOpenFit}>
              {t('fitTitle')}
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-sm)' }}>chevron_right</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Strings line's label, with the string's packet under it when the catalog
 * string has one. The packet's string is drawn in the colour the RACKET is
 * strung in — the member's pick, else the stock white every racket picture
 * shows — so the two never disagree on the card.
 */
function StringsLabel({ text, item, racket }: { text: string; item: GearItem | null; racket: GearItem | null }) {
  if (!item || !stringPackSrc(item.catalogId)) return <span className="setup-line-label">{text}</span>;
  return (
    <span className="setup-line-label setup-line-label--pack">
      {text}
      <StringPackImage catalogId={item.catalogId} size="line" coil={racket?.look?.string ?? STOCK_STRING} />
    </span>
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
