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
  playerTensionText,
} from '@/lib/stringing';
import { usePush } from '@/lib/usePush';

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
  // Fill only, as on Stats: the radio says which row is picked, the tint
  // backs it up. A button's own border has to be switched off by name.
  border: 'none',
  color: 'inherit',
};
const ROW_ON: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
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
  /**
   * Opens the form at this mains tension instead of 26 lb — the String
   * tension card's "Get it strung at 24 lb" row (`lib/stringingIntent.ts`).
   * Crosses follow at the usual +2.
   */
  initialTension?: number | null;
  /** Opens the form with this shelf string picked — a string's page,
   *  "Restring with this string". Ignored when it is not on the shelf or is
   *  out of stock, so a stale link never picks what cannot be had. */
  initialString?: string | null;
}

/**
 * A player asking for a restring — the intake form, in TWO STEPS
 * (docs/plans/stringing-canvas-redesign.md, Decision 6):
 *
 *   1. what — the racket, the string, its colour;
 *   2. how tight — the tension, a summary with the price, and Send.
 *
 * Then the Sent screen: what to do next (drop the racket off), the job's
 * progress as the widget draws it, and the one opt-in that makes "get notified"
 * true — Turn on notifications.
 *
 * ONE TENSION NUMBER BY DEFAULT. The crosses are derived at +2 lb
 * (`crossesFor`), because that is what a stringer would have chosen anyway —
 * cross strings are shorter and woven through the mains, so they finish looser
 * at the same reference tension. "Separate tension requests for Main and
 * Cross" splits them; unconventional pairs are HINTED at, never refused —
 * someone who wants 28/28 is entitled to it. Splitting the tension no longer
 * turns the string into free text: the two were one "Custom request" switch,
 * and asking for 26/30 threw away the string the player had just picked.
 *
 * WHY THE LIST IS ADMIN-FED. A free-text string field produces "bg80",
 * "BG-80", "Bg 80 white" and "yonex 80" for one spool, and the person who has
 * to reconcile that is the stringer. They declare what they stock on the
 * bench; this reads it.
 *
 * THE LIST IS A SHORT SHELF (docs/design/strings-shelf-spec.md, design 2f):
 * one radio row per string with its gauge, the club's price and a stock band.
 * Out of stock can't be picked; the server does not refuse, and the stringer
 * can say so in person. A string in more than
 * one colour asks which, as `stringColor`, kept OFF the label so stock still
 * matches the job to its reel. "Bring my own string" is the last row and sends
 * what they type as the label.
 *
 * When nothing is stocked yet — or the list could not be read — step 1 asks
 * for the string as free text rather than presenting an empty list. An empty
 * list is a dead end; a text box is not.
 */
export default function RequestStringingSheet({ open, onClose, onRequested, gear, initialTension = null, initialString = null }: Props) {
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
  /** Mains and crosses set apart ("Separate tension requests…"). */
  const [splitTension, setSplitTension] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
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
    setTension(initialTension ?? 26);
    setCrosses(initialTension ? crossesFor(initialTension) : 28);
    setSplitTension(false);
    setStep(1);
  }, [open, initialTension]);

  /* The string a string's page asked for, picked once per opening and only
     once the shelf has answered (it loads after the sheet mounts). */
  const [stringApplied, setStringApplied] = useState(false);
  useEffect(() => {
    if (open) setStringApplied(false);
  }, [open]);
  useEffect(() => {
    if (!open || stringApplied || !initialString || !shelf) return;
    setStringApplied(true);
    const label = shelf.strings.find((l) => l.toLowerCase() === initialString.toLowerCase());
    if (label && shelf.stock?.[label] !== 'out') {
      setOwnString(false);
      setPickedString(label);
    }
  }, [open, stringApplied, initialString, shelf]);

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

  // No list, or a list we could not read, means there is nothing to pick.
  // Free text is the only honest option — once we KNOW. While the list
  // loads, neither control shows (like the racket field above).
  const stringsLoading = stringsStatus === 'loading';
  const offered = shelf?.strings ?? [];
  const mustBeCustom = stringsStatus === 'failed' || (stringsStatus === 'ready' && offered.length === 0);

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
  const stringColor = mustBeCustom || ownString ? '' : colours.length > 1 ? pickedColour : colours[0]?.name ?? '';

  const clamp = (n: number) => Math.max(TENSION_MIN_LB, Math.min(TENSION_MAX_LB, n));
  const stringLabel = (mustBeCustom ? customString : ownString ? ownLabel : pickedString).trim();
  const mains = tension;
  const finalCrosses = splitTension ? crosses : crossesFor(mains);
  /** Step 1 is answered: a racket and a string. Out of stock is unpickable. */
  const canContinue = !!racketLabel.trim() && !!stringLabel;
  const canSubmit = !busy && online && canContinue;
  // Unknown shows no figure at all, like a string with no price set: saying
  // "Ask" off a failed read would be a failure dressed as an answer.
  const ownPriceText = ownPriceCents === 'unknown' ? null : formatServicePrice(ownPriceCents) ?? t('offer.priceAsk');
  const summaryPrice = ownString ? ownPriceText : !mustBeCustom && pickedString ? priceText(pickedString) : null;

  /* A colour is asked only of a string in more than one, and the catalog can
     answer after the string was picked (a "Restring with this string" link
     picks before the catalog loads). Default to the first, as a tap does. */
  useEffect(() => {
    if (colours.length > 1 && !colours.some((c) => c.name === pickedColour)) setPickedColour(colours[0].name);
  }, [colours, pickedColour]);

  function pick(label: string) {
    if (isOut(label)) return;
    setOwnString(false);
    setPickedString(label);
    setPickedColour(stringColours(itemFor(label))[0]?.name ?? '');
  }

  function splitApart() {
    // From the usual pair, so the crosses start where they were.
    setCrosses(crossesFor(tension));
    setSplitTension(true);
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

  const tensionText = `${playerTensionText(mains, finalCrosses)} ${t('lb')}`;
  const summary = [stringLabel, stringColor, tensionText].filter(Boolean).join(' · ');

  /** Step 1: the racket, the string, its colour. */
  const whatStep = (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
        {t('requestSubtitle')}
      </p>

      {/* The kit first, typing second — the stringer is the one who has to
          reconcile "Astrox 88D", "astrox88d" and "88d pro" for one racket. */}
      {kitLoading ? (
        /* Neither control yet. A disabled placeholder says "we are asking"
           without asserting an answer. */
        <input type="text" value="" disabled readOnly placeholder={t('pickRacket')} aria-label={t('whichRacket')} />
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
        <select value={racketLabel} onChange={(e) => setRacketLabel(e.target.value)} aria-label={t('whichRacket')}>
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
        <button type="button" onClick={() => setCustomRacket((v) => !v)} className="link-quiet link-quiet--flush" style={{ justifySelf: 'start' }}>
          {typingRacket ? t('backToKit') : t('otherRacket')}
        </button>
      )}

      {/* Its own section, set apart from the racket above (Grant: "Section is
          too close"). */}
      <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        <span className="section-label-muted">{t('whichString')}</span>
        {stringsLoading ? (
          <input type="text" value="" disabled readOnly placeholder={t('pickString')} aria-label={t('whichString')} />
        ) : mustBeCustom ? (
          <>
            <input
              type="text"
              value={customString}
              onChange={(e) => setCustomString(e.target.value)}
              placeholder={t('stringPlaceholder')}
              aria-label={t('stringPlaceholder')}
              maxLength={80}
            />
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
              {stringsStatus === 'failed' ? t('stringsUnavailable') : t('noStringsYet')}
            </p>
          </>
        ) : (
          <>
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
                    {/* The price, and stock only when it changes the choice:
                        "In stock" on every row was noise (Grant: "Does user
                        care about stock here?"). */}
                    {(price || (band && band !== 'in')) && (
                      <span style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)' }}>
                        {price && <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{price}</span>}
                        {band && band !== 'in' && <StockBadge band={band} />}
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
                visibility:hidden until a layout effect, so `autoFocus` ran on
                an unfocusable field and the keyboard never came up. */}
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
              </div>
            )}
          </>
        )}
      </div>

      {/* Dimmed until step 1 is answered — the same disabled rule as every
          cc-btn — rather than hidden, so the way on is always in view. */}
      <button
        type="button"
        onClick={() => setStep(2)}
        disabled={!canContinue}
        className="cc-btn cc-btn-primary cc-btn-lg"
        style={{ width: '100%' }}
      >
        {t('nextTension')}
      </button>
    </div>
  );

  /** Step 2: how tight, what it comes to, and Send. */
  const howStep = (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-secondary)' }}>bolt</span>
          <span className="fs-md" style={{ fontWeight: 600 }}>{t('tensionTitle')}</span>
        </span>
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('tensionHint')}</p>
      </div>

      {/* Keyed so the swap between one stepper and two crossfades
          (.motion-fade), the way every replaced surface in the app does. */}
      <div key={splitTension ? 'split' : 'one'} className="motion-fade" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {splitTension ? (
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
        <button
          type="button"
          onClick={() => (splitTension ? setSplitTension(false) : splitApart())}
          className="link-quiet link-quiet--flush"
          style={{ justifySelf: 'start' }}
        >
          {splitTension ? t('standardRequest') : t('customRequest')}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--inner-card-border)' }}>
        <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{summary}</span>
        {summaryPrice && <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{summaryPrice}</span>}
      </div>

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
  );

  /** Sent: what to do next, the progress as the widget draws it, and the one
   *  opt-in that makes "get notified" true. */
  const sentStep = (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <p role="status" className="fs-md" style={{ margin: '0', color: 'var(--text-primary)' }}>
        {t('sentBody')}
      </p>
      <div className="bpm-inner-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <span className="section-label-muted">{t('sentLabel')}</span>
          <span className="fs-sm" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{t('sentNext')}</span>
        </div>
        <span className="fs-base" style={{ color: 'var(--text-primary)' }}>
          {[racketLabel.trim(), stringLabel, tensionText].filter(Boolean).join(' · ')}
        </span>
        <SegmentedProgress current={0} labels={[t('segRequested'), t('segWithStringer'), t('segBeingStrung'), t('segReady')]} />
      </div>
      <NotifyButton label={t('turnOnNotifications')} />
      <button type="button" onClick={onClose} className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }}>
        {t('requestDone')}
      </button>
    </div>
  );

  const title = done ? t('sentTitle') : t('requestTitle');

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title}>
      {/* `onClose` on the header renders the shared ✕ (SheetCloseButton). */}
      <BottomSheetHeader onClose={onClose} closeLabel={tCommon('close')}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
          {!done && step === 2 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              aria-label={t('back')}
              style={{ minWidth: 44, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: 'calc(-1 * var(--space-4)) 0 calc(-1 * var(--space-4)) calc(-1 * var(--space-4))', color: 'var(--text-secondary)' }}
            >
              <span className="material-icons icon-lg" aria-hidden="true">chevron_left</span>
            </button>
          )}
          <span className="fs-lg" style={{ fontWeight: 600 }}>{title}</span>
          {!done && (
            <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('stepOf', { step, total: 2 })}</span>
          )}
        </span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {/* Keyed by the step so each one crossfades in (.motion-fade). */}
        <div key={done ? 'sent' : step} className="motion-fade">
          {done ? sentStep : step === 1 ? whatStep : howStep}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}

/**
 * The job's progress the way the home-screen widget draws it: four segments,
 * the reached ones lit, the stage words under them. On the Sent screen it is
 * at the first segment — what was just done — so "Drop it off" reads as next.
 */
function SegmentedProgress({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div aria-hidden="true" style={{ display: 'flex', gap: 'var(--space-1)' }}>
        {labels.map((l, i) => (
          <span key={l} className={`bpm-seg${i <= current ? ' bpm-seg--on' : ''}`} />
        ))}
      </div>
      <ol className="fs-2xs" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none', color: 'var(--text-muted)' }}>
        {labels.map((l, i) => (
          <li key={l} aria-current={i === current ? 'step' : undefined} style={i === current ? { color: 'var(--text-primary)', fontWeight: 600 } : undefined}>{l}</li>
        ))}
      </ol>
    </div>
  );
}

/**
 * "Turn on notifications", only when it would change something — not when
 * push is already on, or impossible on this device (a browser tab on an
 * iPhone, a denied permission), where the button would be a promise this
 * screen cannot keep. Its own component so `usePush` (which probes, and on the
 * native shell listens for token rotation) mounts only on the Sent screen,
 * not under every Stringing tab render.
 */
function NotifyButton({ label }: { label: string }) {
  const push = usePush();
  const online = useOnline();
  if (push.state.status !== 'off') return null;
  return (
    <button
      type="button"
      onClick={() => void push.enable()}
      disabled={push.busy || !online}
      className="cc-btn cc-btn-secondary cc-btn-lg"
      style={{ width: '100%' }}
    >
      <span className="material-icons icon-md" aria-hidden="true">notifications</span>
      {label}
    </button>
  );
}
