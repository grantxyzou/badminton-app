'use client';

import { useEffect, useState } from 'react';
import { formatServicePrice } from '@/lib/stringingRateCard';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import type { UseGear } from '@/components/stats/useGear';
import { useCatalog } from '@/components/stats/useCatalog';
import { stringSpecLine } from '@/lib/gearSetup';
import { parseShelf, shelfPrice, stringColours, stringTypeOf, typeBand, type Shelf } from '@/lib/stringShelf';
import type { CatalogItem } from '@/lib/types';
import StockBadge from './StockBadge';
import {
  TENSION_MIN_LB,
  TENSION_MAX_LB,
  crossesFor,
  isConventionalPair,
} from '@/lib/stringing';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** A row in the string list: inner-card chrome, radius 12. */
const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-4)',
  width: '100%',
  textAlign: 'left',
  padding: 'var(--space-4)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--inner-card-bg)',
  border: '1px solid var(--inner-card-border)',
  color: 'inherit',
};
const ROW_ON: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
  border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onRequested: () => void;
  /**
   * The player's kit, MOUNTED BY THE PARENT and handed down.
   *
   * `useGear` is single-owner by rule (components/stats/CLAUDE.md): four
   * components once read `/api/equipment/gear` independently, two of them
   * writing, each with its own op counter — an out-of-order-response race that
   * shipped twice. Calling it here would be a second owner in this tree, so
   * `StringingCard` owns it and passes the object, the way `GearRegister`
   * does.
   *
   * `null` when there is no identity to read a kit for; the form then behaves
   * exactly as it did before this existed.
   */
  gear: UseGear | null;
}

/**
 * A player asking for a restring — the intake form.
 *
 * TWO STATES, AND THE SIMPLE ONE IS THE DEFAULT
 *
 * Standard: pick a string the club stocks, and set ONE tension
 * number. The crosses are derived at +2 lb (`crossesFor`), because that is
 * what a stringer would have chosen anyway — cross strings are shorter and
 * woven through the mains, so they finish looser at the same reference
 * tension. Asking a player for two numbers invites a pair nobody would pick.
 *
 * Custom: the string becomes free text and the tension splits into mains and
 * crosses, set independently. Unconventional pairs are HINTED at, never
 * refused — someone who wants 28/28 is entitled to it, and blocking would be
 * the app overruling them about their own racket.
 *
 * WHY THE LIST IS ADMIN-FED. A free-text string field produces "bg80",
 * "BG-80", "Bg 80 white" and "yonex 80" for one spool, and the person who has
 * to reconcile that is the stringer. They declare what they stock on the
 * bench; this reads it.
 *
 * THE LIST IS A SHORT SHELF (docs/design/strings-shelf-spec.md, design 2f):
 * one radio row per string with its gauge, the club's price and a stock band.
 * Out of stock can't be picked — the band is advisory and the server does not
 * refuse, so Custom request stays open as the way round. A string in more than
 * one colour asks which, as `stringColor`, kept OFF the label so stock still
 * matches the job to its reel. "Bring my own string" is the last row and sends
 * what they type as the label.
 *
 * When nothing is stocked yet — or the list could not be read — the form falls
 * back to the custom path rather than presenting an empty dropdown. An empty
 * select is a dead end; a text box is not.
 */
export default function RequestStringingSheet({ open, onClose, onRequested, gear }: Props) {
  const t = useTranslations('home.stringing');
  // `close` lives in the shared namespace — every sheet in the app uses it.
  const tCommon = useTranslations('recovery');
  const tSetup = useTranslations('stats.gear.setup');
  const online = useOnline();

  const [shelf, setShelf] = useState<Shelf | null>(null);
  const catalog = useCatalog('string');
  /** Loading and failed used to be the same `null`, so a list still on its
   *  way forced the form into free text and then swapped to a dropdown, and a
   *  list that FAILED said "Grant hasn't listed what he stocks" — untrue. */
  const [stringsStatus, setStringsStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [racketLabel, setRacketLabel] = useState('');
  /* Typing a racket rather than picking one from the kit. Forced when the kit
     is empty or unreadable — an empty select is a dead end, the same reasoning
     the string dropdown already carries. */
  const [customRacket, setCustomRacket] = useState(false);
  const [pickedString, setPickedString] = useState('');
  /** "Bring my own string": a built-in row, not an offered label. */
  const [ownString, setOwnString] = useState(false);
  const [ownLabel, setOwnLabel] = useState('');
  const [pickedColour, setPickedColour] = useState('');
  const [customString, setCustomString] = useState('');
  const [tension, setTension] = useState(26);
  const [crosses, setCrosses] = useState(28);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);

  const kit = gear?.rackets ?? [];
  /**
   * THREE states, not two. `useGear` keeps `loaded` and `loadError` apart on
   * purpose and the first cut folded them back together with `||`, so while
   * the read was still in flight the sheet rendered "Type the racket — we'll
   * add it to your kit": an affirmative claim that the bag is empty, made
   * before anything had answered. That is the lying-empty-state rule, in code
   * written the same day as four fixes for it.
   *
   * It was reachable in practice — `useActiveName` resolves post-mount, so the
   * gear read starts a tick after the sheet opens, and cold starts here run
   * 10-20s. The control would then swap to a select underneath whatever the
   * player had begun typing.
   */
  const kitLoading = gear !== null && !gear.loaded && !gear.loadError;
  const kitUnreadable = gear === null || gear.loadError;
  const mustTypeRacket = !kitLoading && (kitUnreadable || kit.length === 0);
  const typingRacket = customRacket || mustTypeRacket;
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /* A fresh form every time the sheet opens. `done` and the fields are
     component state and the sheet stays MOUNTED between opens (StringingCard
     renders it unconditionally), so without this a second "Submit a request"
     reopened onto the previous "Sent." screen with no form — a second racket
     needed a page reload (audit 2026-10-11, finding 02). Keyed on the OPEN
     transition only; the string list is fetched once on mount and kept. */
  useEffect(() => {
    if (!open) return;
    setDone(false);
    setError(null);
    setBusy(false);
    setRacketLabel('');
    setCustomRacket(false);
    setPickedString('');
    setOwnString(false);
    setOwnLabel('');
    setPickedColour('');
    setCustomString('');
    setTension(26);
    setCrosses(28);
    setCustom(false);
  }, [open]);

  // The own-string price (docs/plans/bench-redesign.md, PR 2). Unread or
  // failed reads as "Ask", which is what the row said before it existed.
  // Read each time the sheet OPENS: it is mounted, closed, under every Home
  // render, and a price nobody asked to see is not worth a request each time.
  // (Not "once, then never": a guard ref meant to say so is defeated by
  // StrictMode's double effect run, which cancels the first read and skips
  // the second.)
  // 'unknown' until a well-formed answer: a failed read is not "Ask".
  const [ownPriceCents, setOwnPriceCents] = useState<number | null | 'unknown'>('unknown');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`${BASE}/api/stringing/pricing`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // A well-formed answer sets the figure outright, "Ask" (null) included,
        // so a price changed to Ask between opens is not left showing the old
        // one. A throttled/failed answer carries `services: null`: unknown,
        // and the row keeps what it had.
        if (!cancelled && Array.isArray(d?.services)) setOwnPriceCents(typeof d.ownStringCents === 'number' ? d.ownStringCents : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/strings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const parsed = parseShelf(d);
        if (parsed) {
          setShelf(parsed);
          setStringsStatus('ready');
        } else {
          setStringsStatus('failed');
        }
      })
      .catch(() => {
        // Failed: the form falls back to the custom path, and says why.
        if (!cancelled) setStringsStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // No list, or a list we could not read, means the dropdown has nothing to
  // offer. Forcing custom is the only honest option — once we KNOW. While the
  // list loads, neither control shows (like the racket field above).
  const stringsLoading = stringsStatus === 'loading';
  const offered = shelf?.strings ?? [];
  const mustBeCustom = stringsStatus === 'failed' || (stringsStatus === 'ready' && offered.length === 0);
  const isCustom = custom || mustBeCustom;

  const itemFor = (label: string): CatalogItem | null => {
    const id = shelf?.links[label];
    return id && !catalog.loadError ? catalog.items.find((i) => i.id === id) ?? null : null;
  };
  /** The figure, "Ask", or null when no price is set. */
  const priceText = (label: string): string | null => {
    if (!shelf) return null;
    const p = shelfPrice(shelf, label);
    return p === undefined ? null : p ?? t('offer.priceAsk');
  };
  const isOut = (label: string) => shelf?.stock?.[label] === 'out';
  const pickedItem = !ownString && pickedString ? itemFor(pickedString) : null;
  const colours = stringColours(pickedItem);
  /* More than one colour asks which; a single colour (or a two-tone, which is
     one name) is sent as it is; an unlinked string or your own sends none. */
  const stringColor = isCustom || ownString ? '' : colours.length > 1 ? pickedColour : colours[0]?.name ?? '';

  const clamp = (n: number) => Math.max(TENSION_MIN_LB, Math.min(TENSION_MAX_LB, n));
  const stringLabel = (isCustom ? customString : ownString ? ownLabel : pickedString).trim();
  const mains = tension;
  const finalCrosses = isCustom ? crosses : crossesFor(mains);
  const canSubmit = !busy && online && !!racketLabel.trim() && !!stringLabel;
  // Unknown shows no figure at all, like a string with no price set: saying
  // "Ask" off a failed read would be a failure dressed as an answer.
  const ownPriceText = ownPriceCents === 'unknown' ? null : formatServicePrice(ownPriceCents) ?? t('offer.priceAsk');
  const summaryPrice = ownString ? ownPriceText : pickedString ? priceText(pickedString) : null;

  function pick(label: string) {
    if (isOut(label)) return;
    setOwnString(false);
    setPickedString(label);
    setPickedColour(stringColours(itemFor(label))[0]?.name ?? '');
  }

  function enterCustom() {
    // Carry the simple choice forward rather than resetting: someone opening
    // custom usually wants to ADJUST what they had, not start over.
    const carried = ownString ? ownLabel : pickedString;
    if (!customString && carried) setCustomString(carried);
    setCrosses(crossesFor(tension));
    setCustom(true);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/stringing/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          racketLabel: racketLabel.trim(),
          stringLabel,
          ...(stringColor ? { stringColor } : {}),
          tensionMains: mains,
          tensionCrosses: finalCrosses,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(t(`error.${data.error ?? 'generic'}`));
        setBusy(false);
        return;
      }
      /**
       * A racket they typed goes into their kit, so next time it is a tap.
       *
       * Deliberately AFTER the request has succeeded and deliberately unable to
       * fail it: the restring is what they came for, and a full bag or an
       * expired cookie must not turn a placed request into an error. Same
       * best-effort posture as the stringing notifier — do the main thing, then
       * try the nicety.
       *
       * `catalogId: null` is the supported shape for a free-text entry, and the
       * endpoint dedupes on the normalised label, so re-typing a racket already
       * in the kit is a no-op rather than a duplicate.
       */
      if (typingRacket && gear) {
        try {
          await gear.addCustom(racketLabel.trim());
        } catch {
          /* the request stands either way */
        }
      }

      setDone(true);
      setBusy(false);
      onRequested();
    } catch {
      setError(t('error.generic'));
      setBusy(false);
    }
  }

  function stepper(label: string, value: number, set: (n: number) => void) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <span className="fs-md" style={{ flex: 1 }}>{label}</span>
        <button
          type="button"
          onClick={() => set(clamp(value - 1))}
          aria-label={t('decrease', { field: label })}
          className="cc-btn cc-btn-secondary"
          style={{ width: 44, height: 44, borderRadius: 'var(--radius-pill)', padding: '0' }}
        >
          <span className="material-icons icon-sm">remove</span>
        </button>
        <span
          className="fs-stat"
          style={{ minWidth: 62, textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
        >
          {value}
          <span className="fs-sm" style={{ marginLeft: 'var(--space-05)', color: 'var(--text-muted)' }}>
            {t('lb')}
          </span>
        </span>
        <button
          type="button"
          onClick={() => set(clamp(value + 1))}
          aria-label={t('increase', { field: label })}
          className="cc-btn cc-btn-secondary"
          style={{ width: 44, height: 44, borderRadius: 'var(--radius-pill)', padding: '0' }}
        >
          <span className="material-icons icon-sm">add</span>
        </button>
      </div>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('requestTitle')}>
      {/* `onClose` on the header renders the shared ✕ (SheetCloseButton):
          this sheet once passed a bare string and shipped with no visible way
          out, then hand-rolled its own button; the primitive is the one
          44px target every sheet shares. */}
      <BottomSheetHeader onClose={onClose} closeLabel={tCommon('close')}>
        <span className="fs-lg" style={{ fontWeight: 600 }}>{t('requestTitle')}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {done ? (
          <div className="motion-fade" style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p role="status" className="fs-md" style={{ margin: '0', color: 'var(--text-primary)' }}>
              {t('requestSent')}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {t('requestDone')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
              {t('requestSubtitle')}
            </p>

            {/* The kit first, typing second — mirroring the string control right

                below, and for the same reason: the stringer is the one who has to

                reconcile "Astrox 88D", "astrox88d" and "88d pro" for one racket. */}

            {kitLoading ? (
              /* Neither control yet. A disabled placeholder says "we are
                 asking" without asserting an answer, and does not steal focus
                 into a field that is about to be replaced. */
              <input
                type="text"
                value=""
                disabled
                readOnly
                placeholder={t('pickRacket')}
                aria-label={t('whichRacket')}
              />
            ) : typingRacket ? (
              <input
                type="text"
                value={racketLabel}
                onChange={(e) => setRacketLabel(e.target.value)}
                placeholder={t('racketPlaceholder')}
                aria-label={t('whichRacket')}
                maxLength={80}
                autoFocus
              />
            ) : (
              <select
                value={racketLabel}
                onChange={(e) => setRacketLabel(e.target.value)}
                aria-label={t('whichRacket')}
              >
                <option value="">{t('pickRacket')}</option>
                {kit.map((r) => (
                  <option key={r.id} value={r.label}>{r.label}</option>
                ))}
              </select>
            )}


            {mustTypeRacket ? (
              <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
                {kitUnreadable && gear?.loadError ? t('kitUnavailable') : t('noRacketsYet')}

              </p>
            ) : (
              <button

                type="button"

                onClick={() => setCustomRacket((v) => !v)}

                className="link-quiet"

              >

                {typingRacket ? t('backToKit') : t('otherRacket')}

              </button>

            )}

            {stringsLoading && !custom ? (
              /* Asking, not answering: the same disabled placeholder the racket
                 field uses while the kit loads. */
              <input
                type="text"
                value=""
                disabled
                readOnly
                placeholder={t('pickString')}
                aria-label={t('whichString')}
              />
            ) : isCustom ? (
              <input
                type="text"
                value={customString}
                onChange={(e) => setCustomString(e.target.value)}
                placeholder={t('stringPlaceholder')}
                aria-label={t('stringPlaceholder')}
                maxLength={80}
              />
            ) : (
              <>
                <span className="section-label-muted">{t('whichString')}</span>
                {/* Once, for the whole list: a failed catalog says nothing about
                    any one string, so no row claims to be "not in the catalog". */}
                {catalog.loadError && (
                  <p className="fs-sm" role="status" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('offer.catalogError')}</p>
                )}
                <div role="radiogroup" aria-label={t('whichString')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {offered.map((label) => {
                    const item = itemFor(label);
                    const on = !ownString && pickedString === label;
                    const out = isOut(label);
                    const band = shelf?.stock?.[label] ?? null;
                    const price = priceText(label);
                    const mm = typeof item?.attributes?.gaugeMm === 'number' ? item.attributes.gaugeMm : null;
                    return (
                      <button
                        key={label}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-disabled={out || undefined}
                        aria-label={out ? t('outOfStock', { name: label }) : undefined}
                        onClick={() => pick(label)}
                        style={{ ...ROW, ...(on ? ROW_ON : null), cursor: out ? 'default' : 'pointer', opacity: out ? 0.5 : 1 }}
                      >
                        <span className="material-icons icon-lg" aria-hidden="true" style={{ flex: 'none', color: on ? 'var(--accent)' : 'var(--text-muted)' }}>
                          {on ? 'radio_button_checked' : 'radio_button_unchecked'}
                        </span>
                        {item && (
                          <span aria-hidden="true" style={{ flex: 'none', width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: typeBand(stringTypeOf(item)), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {mm !== null ? mm.toFixed(2) : ''}
                          </span>
                        )}
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="fs-md" style={{ display: 'block', color: 'var(--text-primary)' }}>{label}</span>
                          {(item || !catalog.loadError) && (
                            <span className="fs-sm" style={{ display: 'block', color: 'var(--text-muted)' }}>
                              {item ? stringSpecLine(item, (k) => tSetup(k)) : t('offer.unknown')}
                            </span>
                          )}
                        </span>
                        {(price || band) && (
                          <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)' }}>
                            {price && <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{price}</span>}
                            {band && <StockBadge band={band} />}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={ownString}
                    onClick={() => { setOwnString(true); setPickedString(''); }}
                    style={{ ...ROW, ...(ownString ? ROW_ON : null), cursor: 'pointer' }}
                  >
                    <span className="material-icons icon-lg" aria-hidden="true" style={{ flex: 'none', color: ownString ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {ownString ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="fs-md" style={{ display: 'block', color: 'var(--text-primary)' }}>{t('bringOwn')}</span>
                      <span className="fs-sm" style={{ display: 'block', color: 'var(--text-muted)' }}>{t('bringOwnSub')}</span>
                    </span>
                    {ownPriceText && (
                      <span className="fs-md" style={{ flex: 'none', fontFamily: 'var(--font-mono)', color: ownPriceCents === null ? 'var(--text-muted)' : 'var(--text-primary)' }}>{ownPriceText}</span>
                    )}
                  </button>
                </div>
                {/* Mounted, not <Collapse>d: Collapse holds its content at
                    visibility:hidden until a layout effect, so `autoFocus` ran
                    on an unfocusable field and the keyboard never came up. And
                    this column is a grid with a gap, which a collapsing child
                    cannot animate (the gap snaps). */}
                {ownString && (
                  <input
                    type="text"
                    value={ownLabel}
                    onChange={(e) => setOwnLabel(e.target.value)}
                    placeholder={t('bringOwnPlaceholder')}
                    aria-label={t('bringOwnPlaceholder')}
                    maxLength={80}
                    autoFocus
                  />
                )}
                {colours.length > 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-05)' }}>
                    <span className="section-label-muted">{t('colour')}</span>
                    <div role="radiogroup" aria-label={t('colour')} style={{ display: 'flex', flexWrap: 'wrap', columnGap: 'var(--space-2)' }}>
                      {colours.map((c) => {
                        const on = pickedColour === c.name;
                        return (
                          <button
                            key={c.name}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setPickedColour(c.name)}
                            style={{ minHeight: 44, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'inherit' }}
                          >
                            {/* The app's chip (`.filter-chip`), inside a 44px hit area. */}
                            <span className={on ? 'filter-chip filter-chip--applied' : 'filter-chip'}>
                              <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', background: c.fill, boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 30%, transparent)' }} />
                              {c.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('colourNote')}</p>
                  </div>
                )}
              </>
            )}

            {isCustom ? (
              <>
                {stepper(t('mains'), mains, setTension)}
                {stepper(t('crosses'), crosses, setCrosses)}
                {!isConventionalPair(mains, crosses) && (
                  <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
                    {t('unusualPair', { suggested: crossesFor(mains) })}
                  </p>
                )}
              </>
            ) : (
              stepper(t('tension'), tension, setTension)
            )}

            {stringsLoading ? null : mustBeCustom ? (
              <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
                {stringsStatus === 'failed' ? t('stringsUnavailable') : t('noStringsYet')}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => (custom ? setCustom(false) : enterCustom())}
                className="link-quiet"
              >
                {custom ? t('standardRequest') : t('customRequest')}
              </button>
            )}

            {!isCustom && stringLabel && (
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--inner-card-border)' }}>
                <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>
                  {stringColor
                    ? t('summary', { string: stringLabel, colour: stringColor, tension: mains })
                    : t('summaryNoColour', { string: stringLabel, tension: mains })}
                </span>
                {summaryPrice && <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{summaryPrice}</span>}
              </div>
            )}

            {error && <p className="field-error" role="alert">{error}</p>}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('requestSending') : t('sendCta')}
            </button>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
