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
import {
  blankStringPairing,
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
import { racketHeadSrc } from '@/lib/racketLook';
import { STOCK_STRING } from '@/lib/racketCustom';

export interface GearSetupCardProps {
  activeName: string | null;
  /** The register's single `UseGear` — never a second instance (see `GearRegister`). */
  gear: UseGear;
  /** The register's single recommend reader — the blank strings line's pairing. */
  picks: UseGearPicks;
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
 * to be named or a filled row.
 *
 * It holds no gear state: the doc, the picks and the tally all arrive as the
 * register's single instances, so adding from a sheet updates this card with
 * no refetch and nothing here can disagree with anything else on screen.
 *
 * Three non-ready states, and none of them draws the lines. An unread card
 * must not read as an empty one — dashed slots over a bag that failed to load
 * invite logging a racket that is already logged.
 */
export default function GearSetupCard({ activeName, gear, picks, onOpenLine, onOpenSpare, onShare, onOpenFit, onAddTension, onAddSpare }: GearSetupCardProps) {
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

  // Each line names itself in its sub-line ("Main racket · 4U · even",
  // "Strings · 0.68mm · repulsion"): the label rows above every line stacked
  // the card three lines deep (Grant on the canvas, 2026-11-05: "vertical
  // cluttered"). How many others play the racket or the string is not on the
  // card; "What the club plays" carries it.
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
  function racketSub(item: GearItem): string {
    // A typed-in racket describes itself in the member's own answers.
    const spec = item.catalogId ? racketSpecLine(catalog.get(item.catalogId)) : racketFeelLine(item.feel, (k) => ts(k));
    return join(ts('mainRacket'), spec);
  }
  function stringSpec(catalogId: string | null): string | null {
    return catalogId ? stringSpecLine(catalog.get(catalogId), (k) => ts(k)) : null;
  }

  // The pairing for a BLANK strings line — one rule, shared with the
  // register's tension stand-down (see `tensionOnScreen`).
  const pairing = blankStringPairing({ racket, spares, string, filled }, picks.view.string);
  const pairingText = pairing
    ? (typeof pairing.tensionLbs === 'number'
        ? ts('pairSuggestion', { string: pairing.item.model, lb: pairing.tensionLbs })
        : ts('pairSuggestionNoLb', { string: pairing.item.model }))
    : null;
  // The packet's string is drawn in the colour the RACKET is strung in: the
  // member's pick, else the stock white every racket picture shows.
  const coil = racket?.look?.string ?? STOCK_STRING;

  return (
    <div className={`glass-card p-5 setup-card${refract ? ' setup-card--refract' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* The main racket's head, close up and sharp, across the right half of
          the card (Grant, 2026-11-05: "Only for main racket", "bigger more
          close up and takes 1.5/3 of the card"; design A on the canvas). Its
          own large render (`racketHeadSrc`), never the list picture scaled up,
          faded into the card on its left. Decorative: no name, no tap. */}
      {racket && !gear.loadError && (
        <span className="setup-corner" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin pre-rendered WebP; next/image adds nothing here. */}
          <img key={racket.id} src={racketHeadSrc(racket.catalogId)} alt="" width={540} height={646} decoding="async" className="motion-fade" />
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
          // On glass when the racket is behind it, like every control over it.
          racket ? <span className="setup-glass setup-glass-pill"><StatusBadge>{ts('progress', { filled })}</StatusBadge></span>
            : <StatusBadge>{ts('progress', { filled })}</StatusBadge>
        )}
        {!gear.loadError && filled === 2 && onShare && (
          <button type="button" className="setup-share-btn setup-glass" onClick={onShare}>
            <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-sm)' }}>ios_share</span>
            {ts('share')}
          </button>
        )}
      </div>

      <div className="setup-main">
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
            {/* Main racket: its name on the title's left edge. */}
            <button
              type="button"
              className={`setup-item${racket ? '' : ' setup-item--blank'}`}
              onClick={() => onOpenLine('racket')}
              disabled={!gear.online}
            >
              <span className="setup-item-body">
                <span className="setup-line-value">{racket ? racket.label : ts('tapToName')}</span>
                <span className="setup-line-sub">{racket ? racketSub(racket) : ts('mainRacket')}</span>
              </span>
              {!racket && <EditGlyph />}
            </button>

            {/* Strings: the packet, then the string centred on it, then its
                tension. A hybrid is still ONE line: mains over crosses, each
                with its own packet and figure, and the whole line opens the
                sheet where both tensions are set. */}
            {string?.crosses ? (
              <button type="button" className="setup-item setup-item--pair" onClick={() => onOpenLine('string')} disabled={!gear.online}>
                {([
                  ['mains', string.catalogId, string.label, string.tensionLbs],
                  ['crosses', string.crosses.catalogId, string.crosses.label, string.crosses.tensionLbs],
                ] as const).map(([role, catalogId, name, lbs]) => (
                  <span key={role} className="setup-item-row">
                    <Packet catalogId={catalogId} coil={coil} />
                    <span className="setup-item-body">
                      <span className="setup-line-value">{name}</span>
                      <span className="setup-line-sub">{join(ts(role), stringSpec(catalogId))}</span>
                    </span>
                    {typeof lbs === 'number' && <Tension lbs={lbs} unit={t('lb')} />}
                  </span>
                ))}
              </button>
            ) : string && !(typeof string.tensionLbs === 'number') && onAddTension ? (
              /* A div, not a button, when filled with a tension slot: the slot
                 is its own button and buttons do not nest. */
              <div className="setup-item">
                <button type="button" onClick={() => onOpenLine('string')} disabled={!gear.online} className="setup-item-hit">
                  <Packet catalogId={string.catalogId} coil={coil} />
                  <span className="setup-item-body">
                    <span className="setup-line-value">{string.label}</span>
                    <span className="setup-line-sub">{join(t('catString'), stringSpec(string.catalogId))}</span>
                  </span>
                </button>
                <button type="button" className="setup-chip-dashed setup-glass" onClick={() => onAddTension(string)} disabled={gear.busy}>
                  {ts('addLb')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`setup-item${string ? '' : ' setup-item--blank'}`}
                onClick={() => onOpenLine('string')}
                disabled={!gear.online}
              >
                {string && <Packet catalogId={string.catalogId} coil={coil} />}
                <span className="setup-item-body">
                  <span className="setup-line-value">{string ? string.label : ts('tapToName')}</span>
                  <span className="setup-line-sub">{string ? join(t('catString'), stringSpec(string.catalogId)) : t('catString')}</span>
                  {!string && pairingText && <span className="setup-line-sub setup-line-sub--accent">{pairingText}</span>}
                </span>
                {string && typeof string.tensionLbs === 'number' ? (
                  <Tension lbs={string.tensionLbs} unit={t('lb')} />
                ) : !string ? (
                  <EditGlyph accent={!!pairingText} glass={!!racket} />
                ) : null}
              </button>
            )}

            {filled === 0 && (
              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-normal)', color: 'var(--text-secondary)' }}>
                {ts('arriveHint')}
              </p>
            )}
          </>
        )}

        {/* "Racket and tension fitting", in the main area under the racket and
            its string (Grant, 2026-11-05). OUTSIDE the error fork and never
            disabled: on the day the gear read fails it is the only door to the
            fit page, and so the only way to clear a stored comfort answer. */}
        {onOpenFit && (
          <button type="button" className="setup-fit-row" onClick={onOpenFit}>
            {ts('fitting')}
            <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)' }}>chevron_right</span>
          </button>
        )}
      </div>

      {/* Spare rackets, below a divider (Grant, 2026-11-05: "Racket and String
          should be next to each other then a divider below show spare
          rackets"), as one group with "Add a spare racket" ("a little
          disjointed" when the add link sat alone in a footer). A spare's row
          is its name only ("Dont show the string for spare"); tapping it opens
          that racket's own sheet, where its string is and it can be swapped
          in. Only once there is a racket to be a spare TO, never over a bag
          that failed to load. */}
      {racket && !gear.loadError && (spares.length > 0 || onAddSpare) && (
        <div className="setup-spares">
          <p className="section-label-muted" style={{ margin: 0, fontSize: 'var(--fs-2xs)' }}>{ts('spareRackets')}</p>
          <div className="setup-spare-rows">
            {spares.map((spare) => (
              <button
                key={spare.id}
                type="button"
                className="setup-spare-row"
                onClick={() => onOpenSpare?.(spare.id)}
                disabled={!gear.online || !onOpenSpare}
              >
                <span className="setup-spare-name">{spare.label}</span>
                <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>chevron_right</span>
              </button>
            ))}
            {onAddSpare && (
              <button type="button" className="setup-spare-row setup-spare-row--add" onClick={onAddSpare} disabled={!gear.online}>
                <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)' }}>add</span>
                {ts('addSpare')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A catalog string's packet at the start of its line; nothing for a string
 *  with no packet, so its name still starts on the title's edge. */
function Packet({ catalogId, coil }: { catalogId: string | null; coil: string }) {
  if (!stringPackSrc(catalogId)) return null;
  return <StringPackImage catalogId={catalogId} size="line" coil={coil} />;
}

function Tension({ lbs, unit }: { lbs: number; unit: string }) {
  return (
    <span className="setup-tension setup-glass">
      {/* Keyed: a just-saved tension ticks in, instead of the number silently
          being different when the sheet closes. */}
      <span key={lbs} className="setup-tension-value animate-count-tick">{lbs}</span>
      <span className="setup-tension-unit">{unit}</span>
    </span>
  );
}

/** The pencil on an empty line; on a glass disc when the racket's head is
 *  behind it, or it vanishes into the strings. */
function EditGlyph({ accent = false, glass = false }: { accent?: boolean; glass?: boolean }) {
  return (
    <span
      className={`material-icons${glass ? ' setup-glass setup-glass-icon' : ''}`}
      aria-hidden="true"
      style={{ fontSize: 'var(--icon-md)', color: accent ? 'var(--accent)' : 'var(--text-muted)', alignSelf: 'center' }}
    >
      edit
    </span>
  );
}
