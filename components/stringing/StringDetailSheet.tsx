'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import StatusBadge from '@/components/primitives/StatusBadge';
import ErrorState from '@/components/primitives/ErrorState';
import { isRefused } from '@/lib/apiFetch';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import Collapse from '@/components/primitives/Collapse';
import { catalogSpecRows } from '@/lib/catalogSpecs';
import { cadRange } from '@/lib/catalogPrice';
import { CLUB_GEAR_MIN_COHORT } from '@/lib/clubGear';
import { ratingSourceKey } from './RatingMeters';
import StringPackImage from './StringPackImage';
import { TRAITS, bestForOf, feelWordOf, stringTypeOf, traitTint, traitValueOf, type StockBand } from '@/lib/stringShelf';
import { ColourList } from './StringColours';
import type { CustomColour, ReelColourId } from '@/lib/stringPalette';
import type { CatalogItem, StringFit } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** A chip in the specs: inner-card fill, radius 8. */
const CHIP: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-4)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--inner-card-bg)',
  border: '1px solid transparent',
  color: 'var(--text-secondary)',
};

type FitState = { status: 'loading' } | { status: 'none' } | { status: 'failed' } | { status: 'ready'; fit: StringFit };

/**
 * One string the club offers, and what it means for THIS member (Stringing
 * canvas; Grant, 2026-11-12: "This info should be on the first page in
 * Strings we offer. And then, this section should more focus on the match and
 * recommendation of the stringer").
 *
 *   - a slim strip: the packet, what it is ("Power · Hard feel"), its gauge
 *     and stock in words, and the club's price. The type, feel, stock and
 *     what it is for lead each row of the list now, so the page does not
 *     repeat them at size, and the description is not repeated at all;
 *   - "How it suits you" LEADS: the member's own racket, the pairing engine's
 *     verdict and reason (`/api/stringing/fit`), and the tension and level
 *     checks. Absent when the engine cannot say — no check-in, or no racket
 *     the catalog knows — never filled with a guess;
 *   - "Your stringer recommends": the stringer's own note on this string
 *     (`OfferedStringsDoc.notes`), only when there is one;
 *   - "Ratings and specs", closed: the meters with whose ratings they are,
 *     the tension window, the level and how many in the club play it;
 *   - "Restring with this string", pinned in the footer.
 */
export default function StringDetailSheet({
  item,
  label,
  open,
  onClose,
  price,
  band = null,
  clubCount = null,
  note = null,
  onRestring,
  asPage = false,
  colours = [],
  customColours = [],
}: {
  item: CatalogItem | null;
  /** The shelf's own name for it, which is what a request sends. */
  label?: string | null;
  open: boolean;
  onClose: () => void;
  /** The club's price: a figure, `null` for "Ask", `undefined` when none is set. */
  price?: string | null;
  band?: StockBand | null;
  clubCount?: number | null;
  /** The stringer's note on this string; nothing shows without one. */
  note?: string | null;
  /** Opens the request sheet with this string picked. No button without it. */
  onRestring?: (label: string) => void;
  /** Drawn as a page (a card with its own heading and button) rather than a
   *  sheet: a foldable's right page, beside the shelf. `open` and `onClose`
   *  are unused then; the page is open while it is rendered. */
  asPage?: boolean;
  /** The stringer's reel colours for this string, and the club's own names. */
  colours?: ReelColourId[];
  customColours?: readonly CustomColour[];
}) {
  const t = useTranslations('home.stringing.offer');
  const a = item?.attributes ?? {};
  const num = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : null);
  const type = stringTypeOf(item);
  const feel = feelWordOf(item);
  const mm = num('gaugeMm');
  const shopRange = item ? cadRange(item) : null;
  const hasPrice = price !== undefined;
  const source = ratingSourceKey(a.ratingSource);
  const stringerNote = note?.trim() || null;

  // The maker's five, repulsion first, as the maker prints them; a rating the
  // maker does not give is left out rather than drawn empty.
  const bars = TRAITS.map((tr) => ({ trait: tr, value: traitValueOf(tr, item) })).filter((b): b is { trait: typeof b.trait; value: number } => b.value !== null);
  const bestFor = bestForOf(item);

  const headline = [type ? t(`hero_${type}`) : null, feel ? t(`heroFeel_${feel}`) : null].filter(Boolean).join(' · ');
  const subline = [mm !== null ? t('gaugeMm', { mm: mm.toFixed(2) }) : null, band ? t(`stock_${band}`) : null].filter(Boolean).join(' · ');

  // Tension range and level, from the same curated rows as Specs.
  const facts = item ? catalogSpecRows(item).filter((r) => r.labelKey === 'specTension' || r.labelKey === 'specLevel') : [];
  const showCount = clubCount !== null && clubCount >= CLUB_GEAR_MIN_COHORT;
  const hasSpecs = !!source || facts.length > 0 || showCount;
  const [specsOpen, setSpecsOpen] = useState(false);
  const specsId = useId();

  const [fit, setFit] = useState<FitState>({ status: 'loading' });
  const [fitAttempt, setFitAttempt] = useState(0);
  const itemId = item?.id ?? null;
  useEffect(() => {
    if ((!open && !asPage) || !itemId) return;
    let cancelled = false;
    setFit({ status: 'loading' });
    fetch(`${BASE}/api/stringing/fit?id=${encodeURIComponent(itemId)}`, { cache: 'no-store' })
      // Refused (an expired session) is not a failure to retry: the section
      // simply has nothing to say about a member it cannot see.
      .then((r) => (isRefused(r) ? { fit: null } : r.ok ? r.json() : Promise.reject(new Error(`fit ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        setFit(d && d.fit ? { status: 'ready', fit: d.fit as StringFit } : { status: 'none' });
      })
      .catch(() => { if (!cancelled) setFit({ status: 'failed' }); });
    return () => { cancelled = true; };
  }, [open, asPage, itemId, fitAttempt]);

  const title = item ? `${item.brand} ${item.model}` : '';
  const canRestring = !!(item && onRestring && label && band !== 'out');
  const restringButton = canRestring ? (
    <button
      type="button"
      className="cc-btn cc-btn-primary cc-btn-lg"
      style={{ width: '100%' }}
      onClick={() => onRestring!(label!)}
    >
      {t('restringWith')}
    </button>
  ) : null;

  const body = item && (
          // Sections 24px apart; each label sits close over its own content.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
            {/* What it is, under its name (the sheet's title). */}
            {(headline || subline) && (
              <div data-testid="string-strip">
                {headline && <span className="fs-md" style={{ display: 'block', fontWeight: 600, color: 'var(--text-primary)' }}>{headline}</span>}
                {subline && <span className="fs-sm" style={{ display: 'block', color: 'var(--text-muted)' }}>{subline}</span>}
              </div>
            )}

            {/* How it plays (the canvas, frame 3): the packet beside what it is
                for and the maker's five ratings, each a bar in its trait's
                colour with its name and number inside it. */}
            {(bars.length > 0 || bestFor) && (
              <section aria-label={t('howItPlays')} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
                <StringPackImage catalogId={item.id} size="hero" />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <span className="section-label-muted">{t('howItPlays')}</span>
                  {bestFor && <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 'var(--lh-snug)' }}>{bestFor}</p>}
                  {bars.length > 0 && (
                    <ul data-testid="trait-bars" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      {bars.map((bar) => <TraitBar key={bar.trait} trait={bar.trait} value={bar.value} />)}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {/* About you: the racket match and the stringer's note in one
                card (Grant: "should we combine?"). */}
            <FitSection state={fit} onRetry={() => setFitAttempt((n) => n + 1)} note={stringerNote} />

            {colours.length > 0 && (
              <section aria-label={t('coloursTitle')} className="flex flex-col gap-2">
                <span className="section-label-muted">{t('coloursTitle')}</span>
                <ColourList ids={colours} customs={customColours} />
              </section>
            )}

            {/* Specs: there for a member who wants them, closed. */}
            {hasSpecs && (
              <div>
                <button
                  type="button"
                  className="bpm-row-link"
                  aria-expanded={specsOpen}
                  aria-controls={specsId}
                  onClick={() => setSpecsOpen((v) => !v)}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <span className="fs-base" style={{ flex: 1, textAlign: 'left' }}>{t('specsTitle')}</span>
                  <span className="material-icons icon-md motion-chevron" data-open={specsOpen ? 'true' : 'false'} aria-hidden="true" style={{ color: 'var(--text-muted)' }}>expand_more</span>
                </button>
                <Collapse open={specsOpen} id={specsId} spaceAbove="var(--space-3)">
                  <div className="flex flex-col gap-4">
                    {source && (
                      <span className="fs-xs" style={{ color: 'var(--text-muted)' }}>
                        {source === 'brand' ? t('ratedBy', { brand: item.brand }) : t('ratedCommunity')}
                      </span>
                    )}
                    {(facts.length > 0 || showCount) && (
                      <div className="fs-sm" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                        {facts.map((f) => <span key={f.labelKey} style={CHIP}>{f.value}</span>)}
                        {showCount && (
                          <span style={CHIP}>
                            <span className="material-icons icon-xs" aria-hidden="true">group</span>
                            {t('clubCount', { count: clubCount! })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Collapse>
              </div>
            )}

            {/* The price last, beside the button it pays for (Grant: "move
                price to the bottom. there might be a cost dependency to color
                in the future"). The shop's typical range only when the club
                has no price of its own. */}
            {hasPrice ? (
              <div data-testid="string-price" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <span className="fs-base" style={{ color: 'var(--text-secondary)' }}>{t('restringFor', { name: label ?? item.model })}</span>
                <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-stat)', fontWeight: 700, color: 'var(--text-primary)' }}>{price ?? t('priceAsk')}</span>
              </div>
            ) : shopRange ? (
              <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {t('typicalPrice', { range: shopRange[0] === shopRange[1] ? `$${shopRange[0]}` : `$${shopRange[0]}–${shopRange[1]}` })}
              </p>
            ) : null}
          </div>
  );

  // The right page of a foldable: the same content as a card, its name as
  // the heading and the button at its foot (nothing scrolls under it here).
  if (asPage) {
    if (!item) return null;
    return (
      <section className="glass-card p-5 flex flex-col gap-5" aria-label={title}>
        <h2 className="bpm-h3" style={{ margin: 0 }}>{title}</h2>
        {body}
        {restringButton}
      </section>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={item ? title : t('title')}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('close')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{title}</span>
      </BottomSheetHeader>
      <BottomSheetBody>{body}</BottomSheetBody>
      {/* Pinned to the bottom of the screen while the string's details scroll
          (Grant, 2026-11-11: every sheet's CTA anchored to the bottom). */}
      {restringButton && <BottomSheetFooter>{restringButton}</BottomSheetFooter>}
    </BottomSheet>
  );
}

// Amber for a caution, the muted pill for a no: "Not for this frame" is an
// answer, not an alarm, and it must not read milder than "Worth a look".
const VERDICT_TONE = { good_match: 'paid', worth_a_look: 'waitlist', not_for_frame: 'unpaid' } as const;

/** One string's bar: its trait's tint, filled to the rating, the name and
 *  number inside it in the trait's colour (the canvas, frame 3). */
function TraitBar({ trait, value }: { trait: (typeof TRAITS)[number]; value: number }) {
  const t = useTranslations('home.stringing.offer');
  const tint = traitTint(trait);
  return (
    <li data-trait={trait} className="string-trait-bar" style={{ background: `color-mix(in srgb, ${tint} 12%, transparent)` }}>
      <span aria-hidden="true" className="string-trait-fill" style={{ width: `${Math.max(0, Math.min(10, value)) * 10}%`, background: `color-mix(in srgb, ${tint} 30%, transparent)` }} />
      <span className="string-trait-text fs-xs" style={{ color: tint }}>
        <span>{trait === 'shock' ? t('traitFull_shock') : t(`trait_${trait}`)}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{value}</span>
      </span>
    </li>
  );
}

/** "How it suits you" with the stringer's note — or the note alone, or
 *  nothing, when the engine cannot say and the stringer said nothing. */
function FitSection({ state, onRetry, note }: { state: FitState; onRetry: () => void; note: string | null }) {
  const t = useTranslations('home.stringing.offer');
  const noteBlock = note ? <StringerNote note={note} /> : null;
  if (state.status === 'none') {
    return noteBlock ? (
      <section aria-label={t('stringerNoteTitle')} className="bpm-inner-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>{noteBlock}</section>
    ) : null;
  }
  return (
    <section aria-label={t('fitTitle')} className="flex flex-col gap-2">
      <span className="section-label-muted">{t('fitTitle')}</span>
      {/* The section's place, held while the engine answers: an absent
          section that pops in would push the colours and the button down. */}
      {state.status === 'loading' ? (
        // 186 at 390px, measured 2026-10-28 (a reason on two lines, both checks).
        <CardSkeleton height={186} />
      ) : state.status === 'failed' ? (
        <>
          <ErrorState
            message={t('fitError')}
            action={<button type="button" className="cc-btn cc-btn-ghost" onClick={onRetry}>{t('retry')}</button>}
          />
          {noteBlock && <div className="bpm-inner-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>{noteBlock}</div>}
        </>
      ) : (
        <FitCard fit={state.fit} note={noteBlock} />
      )}
    </section>
  );
}

/** The stringer's own words on this string, signed, so they read as a
 *  person's beside the engine's. */
function StringerNote({ note }: { note: string }) {
  const t = useTranslations('home.stringing.offer');
  return (
    <div data-testid="stringer-note" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <span className="fs-xs" style={{ color: 'var(--text-muted)' }}>{t('stringerNoteTitle')}</span>
      <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)', whiteSpace: 'pre-line' }}>{note}</p>
    </div>
  );
}

function FitCard({ fit, note }: { fit: StringFit; note?: React.ReactNode }) {
  const t = useTranslations('home.stringing.offer');
  const overlap = fit.frameTension && fit.stringTension
    ? Math.min(fit.frameTension[1], fit.stringTension[1]) >= Math.max(fit.frameTension[0], fit.stringTension[0])
    : null;
  const levelMatch = fit.stringLevel ? fit.stringLevel.toLowerCase().includes(fit.level.toLowerCase()) : null;
  const span = (r: [number, number]) => `${r[0]}–${r[1]}`;

  const checks: { key: string; ok: boolean | null; label: string; value: string }[] = [];
  if (fit.frameTension && fit.stringTension) {
    checks.push({
      key: 'tension',
      ok: overlap,
      label: t('fitTension'),
      value: t('fitTensionValue', { frame: span(fit.frameTension), string: span(fit.stringTension) }),
    });
  }
  if (fit.stringLevel) {
    checks.push({
      key: 'level',
      ok: levelMatch,
      label: t('fitLevel'),
      value: levelMatch ? t('fitLevelSame', { level: fit.stringLevel }) : t('fitLevelOther', { level: fit.stringLevel, you: t(`level_${fit.level}`) }),
    });
  }

  // The page's lead: a good match wears the accent's tint, as the frame
  // draws it; a caution or a no stays on the neutral inner fill, so a tint is
  // never read as a yes it is not. Fill only, no rim.
  return (
    <div
      className="bpm-inner-row"
      data-verdict={fit.verdict}
      style={{
        flexDirection: 'column',
        alignItems: 'stretch',
        ...(fit.verdict === 'good_match'
          ? { background: 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 16%, transparent), color-mix(in srgb, var(--accent) 5%, transparent))' }
          : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <span className="material-icons icon-md" aria-hidden="true" style={{ flex: 'none', color: 'var(--text-muted)' }}>sports_tennis</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="fs-md" style={{ display: 'block', fontWeight: 600 }}>{fit.racket}</span>
          <span className="fs-sm" style={{ display: 'block', color: 'var(--text-muted)' }}>{t('fitFromGear')}</span>
        </span>
        <StatusBadge variant="state" tone={VERDICT_TONE[fit.verdict]}>{t(`fit_${fit.verdict}`)}</StatusBadge>
      </div>
      {fit.reason && (
        // The reason is the answer, so it reads at the lead size.
        <p className="fs-lg" style={{ margin: 0, color: 'var(--text-primary)', lineHeight: 'var(--lh-snug)' }}>{fit.reason}</p>
      )}
      {checks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', paddingTop: 'var(--space-4)' }}>
          {checks.map((c) => (
            <div key={c.key} className="fs-base" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span
                className="material-icons icon-sm"
                aria-hidden="true"
                style={{ flex: 'none', color: c.ok === false ? 'var(--sev-warn)' : 'var(--accent)' }}
              >
                {c.ok === false ? 'warning' : 'check_circle'}
              </span>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{c.label}</span>
              <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{c.value}</span>
            </div>
          ))}
        </div>
      )}
      {note && <div className="string-fit-note">{note}</div>}
    </div>
  );
}
