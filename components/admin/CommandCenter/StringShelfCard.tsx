'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import ListRow from '@/components/primitives/ListRow';
import Collapse from '@/components/primitives/Collapse';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import { useCatalog } from '@/components/stats/useCatalog';
import { useOnline } from '@/lib/useOnline';
import { MAX_OFFERED } from '@/lib/stringingLimits';
import { formatServicePrice } from '@/lib/stringingRateCard';
import { LOW_STOCK_SETS, labelKey, type StringStockSummary } from '@/lib/stringStockMath';
import { catalogLabel, matches } from '@/lib/shelfEdit';
import type { CatalogItem, StringPurchase } from '@/lib/types';
import { normaliseColourList, normaliseCustomColours, type CustomColour, type ReelColourId } from '@/lib/stringPalette';
import { clubCombos } from '@/lib/stringShelf';
import StringShelfSheet, { type ShelfEdits, type ShelfSheetMode } from './StringShelfSheet';
import StringPurchaseSheet from './StringPurchaseSheet';
import { ColourDots } from '@/components/stringing/StringColours';
import StocktakeSheet from '@/components/stringing/StocktakeSheet';
import { ShelfPack, shelfHasPacks } from '@/components/stringing/StringPackImage';
import {
  FOLDED_BY_DEFAULT, LARGE_SHELF, NEEDS_YOU, filterId, shelfChips, shelfGroups, shelfStatus,
  type ShelfChip, type ShelfEntry, type ShelfFilter, type ShelfStatus,
} from '@/lib/shelfList';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Stock = StringStockSummary & { purchases: StringPurchase[]; aliases?: Record<string, string> };
interface Shelf {
  strings: string[];
  links: Record<string, string>;
  prices: Record<string, number | null>;
  aliases: Record<string, string>;
  colours: Record<string, ReelColourId[]>;
  notes: Record<string, string>;
  /** The club's own colours (`custom:<rrggbb>`), named. */
  customColours: CustomColour[];
}

/** The route's note map, non-empty strings only. */
function notesOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, note] of Object.entries(v)) if (typeof note === 'string' && note.trim()) out[k] = note;
  }
  return out;
}

/** The route's colour map, reel colour ids only (a club colour only while `customs` names it). */
function coloursOf(v: unknown, customs: readonly CustomColour[]): Record<string, ReelColourId[]> {
  const ids = new Set(customs.map((c) => c.id));
  const out: Record<string, ReelColourId[]> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, list] of Object.entries(v)) {
      const clean = normaliseColourList(list, ids);
      if (clean.length > 0) out[k] = clean;
    }
  }
  return out;
}

/** The route's answer as the card's shelf. */
function shelfOf(d: Record<string, unknown>): Shelf {
  const customColours = normaliseCustomColours(d.customColours);
  return {
    strings: d.strings as string[],
    links: (d.links as Shelf['links']) ?? {},
    prices: (d.prices as Shelf['prices']) ?? {},
    aliases: (d.aliases as Shelf['aliases']) ?? {},
    colours: coloursOf(d.colours, customColours),
    notes: notesOf(d.notes),
    customColours,
  };
}

/**
 * Keeps the search and filters stuck just under the page's top bar while the
 * list scrolls: the bar condenses on scroll, so its bottom edge is MEASURED
 * (on scroll, once a frame) rather than guessed, and `data-stuck` gives the
 * band the bar's frosted ground only while it is stuck — at rest it is part of
 * the card. The bar is the one on screen (a kept tab's bar sits under
 * `hidden`).
 */
function useStickUnderBar(ref: React.RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bar = Array.from(document.querySelectorAll<HTMLElement>('.bpm-topbar')).find((b) => b.closest('[hidden]') === null);
      const barBottom = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0;
      /* The fixed bell, language and theme buttons hang below a condensed bar
         (Grant, on the canvas: "when the search bar hits very top of the
         screen the card behaves weird"): stick under them, not under the bar,
         and let the band's ground reach up to the bar so the two read as one. */
      const toggles = Array.from(document.querySelectorAll<HTMLElement>('.notif-toggle, .lang-toggle, .theme-toggle'))
        .map((t) => t.getBoundingClientRect())
        .filter((r) => r.height > 0);
      const togglesBottom = toggles.length ? Math.round(Math.max(...toggles.map((r) => r.bottom))) : 0;
      const top = Math.max(barBottom, togglesBottom);
      el.style.setProperty('--shelf-tools-top', `${top}px`);
      el.style.setProperty('--shelf-tools-reach', `${top - barBottom}px`);
      /* Stuck, the ground spans the page's column, edge to edge like the bar,
         not just the card (a stripe with the card's sides showing). */
      const col = (el.closest('main') ?? document.documentElement).getBoundingClientRect();
      const box = el.getBoundingClientRect();
      el.style.setProperty('--shelf-tools-bleed-l', `${Math.max(0, Math.round(box.left - col.left))}px`);
      el.style.setProperty('--shelf-tools-bleed-r', `${Math.max(0, Math.round(col.right - box.right))}px`);
      el.toggleAttribute('data-stuck', window.scrollY > 0 && box.top <= top + 1);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref, on]);
}

/** Each group's label and its filter chip's label. */
const GROUP_LABEL: Record<ShelfStatus, string> = {
  low: 'shelf.groupLow', out: 'shelf.groupOut', mismatched: 'shelf.groupMismatched', shelf: 'shelf.groupShelf', none: 'shelf.groupNone',
};
const GROUP_CHIP: Record<ShelfStatus, string> = {
  low: 'shelf.chipLow', out: 'shelf.chipOut', mismatched: 'shelf.chipMismatched', shelf: 'shelf.groupShelf', none: 'shelf.groupNone',
};

type Line = StringStockSummary['lines'][number];
interface Row extends ShelfEntry {
  line: Line | null;
  hasStock: boolean;
  over: number;
  runway: string | null;
}

/**
 * The strings the club offers, with what each costs a player and what is left
 * on the shelf — ONE list (docs/plans/bench-redesign.md). It replaces "Strings
 * you stock" (chips) and "String stock" (rows), which listed the same strings
 * twice, and a paragraph that told the admin to retype names the jobs had
 * used. Tap a row for everything about that string.
 *
 * Two reads, one answer: the list and prices from `/api/stringing/strings`,
 * the counted stock from `/api/stringing/stock`. Either failing tints the card
 * and hides its controls, so nothing is written against half a picture.
 *
 * Drawn as ONE card holding a plain list (docs/plans/string-inventory-list.md,
 * canvas v3): what needs someone on top under its own label, the strings that
 * are fine folded, a search and filters for a large shelf (`lib/shelfList.ts`),
 * and the stocktake as the header's one filled button. The + beside it is a
 * quiet icon that opens the add field (the top bar's right corner belongs to
 * the app's bell, language and theme buttons); an empty shelf shows the field
 * without it.
 */
export default function StringShelfCard() {
  const t = useTranslations('admin.stringing');
  const online = useOnline();
  const catalog = useCatalog('string');
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [stock, setStock] = useState<Stock | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [draft, setDraft] = useState('');
  const [sheet, setSheet] = useState<{ mode: ShelfSheetMode; label: string; n: number } | null>(null);
  const [purchase, setPurchase] = useState<{ label: string; n: number } | null>(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [counting, setCounting] = useState(false);
  // "The shelf is full" — said, rather than the typed name silently vanishing.
  const [full, setFull] = useState(false);
  const [renameError, setRenameError] = useState<'name_taken' | 'invalid_name' | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ShelfFilter>({ kind: 'all' });
  // Folded groups the admin opened by hand.
  const [opened, setOpened] = useState<ReadonlySet<ShelfStatus>>(() => new Set());
  const [addOpen, setAddOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const large = (shelf?.strings.length ?? 0) > LARGE_SHELF;
  useStickUnderBar(toolsRef, large && shelf !== null && stock !== null);

  const loadStock = useCallback(async () => {
    const res = await fetch(`${BASE}/api/stringing/stock`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`stock ${res.status}`);
    const d = (await res.json()) as Partial<Stock>;
    if (!Array.isArray(d.lines) || !Array.isArray(d.purchases) || !Array.isArray(d.unmatched) || !d.totals) throw new Error('stock shape');
    setStock(d as Stock);
    return d as Stock;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    Promise.all([
      fetch(`${BASE}/api/stringing/strings`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      loadStock(),
    ])
      .then(([d, s]) => {
        if (cancelled) return;
        // `strings: null` is the route's "unknown" (throttled or failed), never an empty shelf.
        if (!Array.isArray(d?.strings)) throw new Error('strings unknown');
        const customColours = normaliseCustomColours(d.customColours);
        setShelf({
          strings: d.strings,
          links: d.links && typeof d.links === 'object' ? d.links : {},
          prices: d.prices && typeof d.prices === 'object' ? d.prices : {},
          aliases: s.aliases && typeof s.aliases === 'object' ? s.aliases : {},
          colours: coloursOf(d.colours, customColours),
          notes: notesOf(d.notes),
          customColours,
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, loadStock]);

  /**
   * Save the shelf. Optimistic with rollback, then re-count the stock, which
   * is keyed by the list. Sends the list and ONLY the maps this change
   * touched: the server keeps a map it is not sent, so a phone left open on
   * this screen cannot write its stale copy of another device's aliases,
   * prices or links back over them (review of the bench redesign, finding 2).
   */
  async function save(next: Partial<Shelf>) {
    if (busy || !online || !shelf) return false;
    const previous = shelf;
    const merged: Shelf = { ...shelf, ...next };
    setShelf(merged);
    setBusy(true);
    setSaveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/strings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strings: merged.strings, ...next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (Array.isArray(d.strings)) {
        setShelf(shelfOf(d));
      }
      await loadStock().catch(() => setLoadError(true));
      return true;
    } catch {
      setShelf(previous);
      setSaveError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }


  /**
   * The sheet's one Save: name, price, note and reel colours together. A new
   * name goes FIRST, on its own (`{ rename }`: the server moves the price,
   * link, colours, note and old spellings on the STORED doc), and the rest is
   * saved under the NEW name in one PATCH that sends the list and only the
   * maps this Save touched — the same rule as `save` above, so another
   * device's aliases and links are never written back stale. The open sheet
   * follows the string to its new name, so a failure after the rename keeps
   * the remaining edits on the string they belong to. Returns whether it all
   * landed.
   */
  async function saveSheet(from: string, edits: ShelfEdits): Promise<boolean> {
    if (busy || !online || !shelf) return false;
    setBusy(true);
    setSaveError(false);
    setRenameError(null);
    let current = shelf;
    let label = from;
    try {
      if (edits.name !== undefined && edits.name !== from) {
        const res = await fetch(`${BASE}/api/stringing/strings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rename: { from, to: edits.name } }),
        });
        if (res.status === 409 || res.status === 400) {
          setRenameError(res.status === 409 ? 'name_taken' : 'invalid_name');
          return false;
        }
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        if (Array.isArray(d.strings)) {
          current = shelfOf(d);
          setShelf(current);
        }
        label = edits.name;
        setSheet((s) => (s && s.label === from ? { ...s, label } : s));
      }
      const next: Partial<Shelf> = {};
      if (edits.price !== undefined) next.prices = { ...current.prices, [label]: edits.price };
      if (edits.note !== undefined) {
        const notes = { ...current.notes };
        if (edits.note) notes[label] = edits.note;
        else delete notes[label];
        next.notes = notes;
      }
      if (edits.colours !== undefined) {
        const colours = { ...current.colours };
        if (edits.colours.length > 0) colours[label] = edits.colours;
        else delete colours[label];
        next.colours = colours;
      }
      if (Object.keys(next).length > 0) {
        // A colour of the club's named in the sheet is added by the same PATCH,
        // ahead of the colour lists that name it (the route does it first).
        const addColours = edits.addColours?.map(({ name, hex }) => ({ name, hex }));
        const res = await fetch(`${BASE}/api/stringing/strings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strings: current.strings, ...next, ...(addColours?.length ? { addColours } : {}) }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        setShelf(Array.isArray(d.strings) ? shelfOf(d) : { ...current, ...next });
      }
      await loadStock().catch(() => setLoadError(true));
      return true;
    } catch {
      setSaveError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removePurchase(id: string) {
    if (busy || !online) return;
    setBusy(true);
    setSaveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/stock?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      await loadStock();
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Add a label (linked to a catalog row when one was picked). Every check runs
   * BEFORE the typed text is cleared, so a refused add keeps it. Returns
   * whether a save was issued. `fromBox` says the label came from the add
   * field, which is the only text this may clear.
   */
  function add(label = draft.trim(), item: CatalogItem | null = null, fromBox = true): boolean {
    if (!label || !shelf || busy || !online) return false;
    const existing = shelf.strings.find((s) => s.toLowerCase() === label.toLowerCase());
    if (existing) {
      if (fromBox) setDraft('');
      if (item && shelf.links[existing] !== item.id) void save({ links: { ...shelf.links, [existing]: item.id } });
      return true;
    }
    if (shelf.strings.length >= MAX_OFFERED) {
      setFull(true);
      return false;
    }
    setFull(false);
    if (fromBox) setDraft('');
    void save(item ? { strings: [...shelf.strings, label], links: { ...shelf.links, [label]: item.id } } : { strings: [...shelf.strings, label] });
    return true;
  }

  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="inventory_2"
        title={t('shelf.title')}
        message={<>{t('shelf.loadError')} <StateLink onClick={() => setAttempt((n) => n + 1)}>{t('retry')}</StateLink></>}
      >
        <PreviewRow width="52%" />
        <PreviewRow width="38%" />
      </StateCard>
    );
  }

  const ready = shelf !== null && stock !== null;
  const lineFor = (label: string) => stock?.lines.find((l) => labelKey(l.label) === labelKey(label)) ?? null;
  const offeredKeys = new Set((shelf?.strings ?? []).map(labelKey));
  const offShelf = (stock?.lines ?? []).filter((l) => !offeredKeys.has(labelKey(l.label)) && l.purchases > 0);
  const jobLabels = stock?.unmatched ?? [];
  const lastCountedAt = (stock?.lines ?? []).reduce<string | null>((latest, l) => (l.lastCount && (!latest || l.lastCount.at > latest) ? l.lastCount.at : latest), null);
  const suggestions = ready ? matches(catalog.items, draft.trim()) : [];

  const openSheet = (mode: ShelfSheetMode, label: string) => {
    setRenameError(null);
    setSheet((s) => ({ mode, label, n: (s?.n ?? 0) + 1 }));
  };
  const closeSheet = () => setSheet(null);
  const sheetLabel = sheet?.label ?? '';
  const sheetLine = sheet ? (sheet.mode === 'jobLabel' ? null : lineFor(sheetLabel)) : null;

  const narrowed = query.trim() !== '' || filter.kind !== 'all';
  const showAdd = addOpen || (ready && shelf.strings.length === 0);
  const withPacks = shelf ? shelfHasPacks(shelf.strings, shelf.links) : false;
  const folded = new Set([...FOLDED_BY_DEFAULT].filter((st) => !opened.has(st)));
  const entries: Row[] = (shelf?.strings ?? []).map((label) => {
    const line = lineFor(label);
    // Known stock: bought, or counted in a stocktake (docs/plans/string-photo-stocktake.md).
    const hasStock = !!line && (line.purchases > 0 || !!line.lastCount);
    // More strung than was ever logged: said rather than hidden behind "None
    // left" (string-stock-audit-fixes).
    const over = hasStock ? line.overdrawnSets ?? 0 : 0;
    // How long it lasts at the recent rate (docs/plans/string-usage-rate.md).
    const reorder = hasStock ? line.reorder ?? null : null;
    const weeks = line?.weeksLeft != null ? Math.max(1, Math.round(line.weeksLeft)) : null;
    const runway = !hasStock ? null
      : reorder === 'now' ? t('shelf.runway.now')
      : reorder === 'soon' && weeks !== null ? t('shelf.runway.soon', { weeks })
      : reorder === 'ok' && weeks !== null ? t('shelf.runway.ok', { weeks })
      : line.setsPerWeek === 0 ? t('shelf.runway.idle')
      : null;
    const linked = shelf!.links[label];
    // The filter's brand: the linked catalog row's maker; a string with no link
    // is "not in the catalog". A link whose row has not loaded yet has no brand.
    const brand = linked ? catalog.items.find((i) => i.id === linked)?.brand ?? null : null;
    const status = shelfStatus({
      hasStock,
      remainingSets: line?.remainingSets ?? 0,
      overdrawnSets: over,
      low: hasStock && line.remainingSets <= LOW_STOCK_SETS,
      reorder,
    });
    return { label, brand, status, line, hasStock, over, runway };
  });
  // A filter whose chip is gone (its last string moved) falls back to All.
  const chips = large ? shelfChips(entries) : [];
  const activeFilter = chips.some((c) => c.id === filterId(filter)) ? filter : { kind: 'all' as const };
  const groups = shelfGroups(entries, large ? { query, filter: activeFilter, folded } : {});

  const chipLabel = (c: ShelfChip) =>
    c.filter.kind === 'all' ? t('shelf.chipAll', { count: c.count })
      : c.filter.kind === 'brand' ? t('shelf.chipBrand', { brand: c.filter.brand, count: c.count })
      : c.filter.kind === 'other' ? t('shelf.chipOther', { count: c.count })
      : t(GROUP_CHIP[c.filter.status], { count: c.count });

  const renderRow = (e: Row) => {
    const { label, line, hasStock, over, runway } = e;
    const warn = NEEDS_YOU.has(e.status);
    const price = shelf!.prices[label];
    return (
      <li key={label}>
        <button type="button" className="shelf-row" onClick={() => openSheet('offered', label)} aria-label={t('shelf.openRow', { name: label })}>
          <ShelfPack catalogId={shelf!.links[label]} reserve={withPacks} size="list" />
          <span className="shelf-row-body">
            <span className="shelf-row-name">{label}</span>
            <span className={warn ? 'shelf-row-line shelf-row-line--warn' : 'shelf-row-line'}>
              <span>
                {hasStock && line ? t('shelf.setsLeft', { count: line.remainingSets }) : t('shelf.noStock')}
                {over > 0 && ` · ${t('shelf.overdrawn', { count: over })}`}
                {runway && ` · ${runway}`}
              </span>
              {(shelf!.colours[label]?.length ?? 0) > 0 && <ColourDots ids={shelf!.colours[label]} customs={shelf!.customColours} />}
            </span>
          </span>
          {/* A figure in the data face; the absence of one in plain muted text,
              so "No price" never reads as a number. */}
          {Object.prototype.hasOwnProperty.call(shelf!.prices, label)
            ? <span className="shelf-row-price">{formatServicePrice(price ?? null) ?? t('strings.priceAsk')}</span>
            : <span className="shelf-row-noprice">{t('shelf.noPrice')}</span>}
          <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>
        </button>
      </li>
    );
  };

  return (
    // A flex gap, not `space-y`: the list below carries its own reset, and an
    // inline margin on a child silently beats `space-y`'s margin-top.
    <div className="glass-card p-5 flex flex-col gap-3">
      {/* The header: name and when the shelf was last counted, then the +
          and the stocktake. Drawn here rather than through CardHeader, which
          top-aligns a trailing action: these two are a button's height and
          sit centred on the title. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44 }}>
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--fs-stat-lg)', color: 'var(--accent)', flex: '0 0 auto' }}>inventory_2</span>
        <h3 className="bpm-h3 m-0" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span>{t('shelf.title')}</span>
          {lastCountedAt && (
            <span className="fs-sm" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span className="sr-only">{t('shelf.lastCountedSr')} </span>
              {new Date(lastCountedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'America/Vancouver' })}
            </span>
          )}
        </h3>
        {ready && shelf.strings.length > 0 && (
          <>
            <button
              type="button"
              className="shelf-add-btn"
              aria-label={t('shelf.addLabel')}
              aria-expanded={addOpen}
              onClick={() => setAddOpen((v) => !v)}
            >
              <span className="material-icons icon-md" aria-hidden="true">add</span>
            </button>
            <button type="button" className="cc-btn cc-btn-primary" onClick={() => setCounting(true)} style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}>
              <span className="material-icons icon-sm" aria-hidden="true">barcode_scanner</span>
              {t('shelf.countNow')}
            </button>
          </>
        )}
      </div>
      {counting && (
        <StocktakeSheet onClose={() => setCounting(false)} onSaved={() => void loadStock().catch(() => setLoadError(true))} />
      )}

      {saveError && <ErrorState message={t('strings.saveError')} />}

      {/* ADD — opened from the page's +; catalog matches for what is typed,
          Enter adds it as typed. */}
      {showAdd && (
        <div className="flex flex-col gap-2">
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <input
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setFull(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder={t('strings.placeholder')}
              aria-label={t('shelf.addLabel')}
              maxLength={60}
              style={{ flex: 1, minWidth: 0 }}
              disabled={!ready}
              autoFocus={addOpen}
            />
            <button type="button" onClick={() => add()} disabled={busy || !online || !draft.trim() || !ready} className="cc-btn cc-btn-secondary">
              {t('strings.add')}
            </button>
          </div>
          {suggestions.length > 0 && (
            <div role="group" aria-label={t('strings.matches')} className="flex flex-col gap-2">
              {suggestions.map((i) => (
                <ListRow
                  key={i.id}
                  disabled={busy || !online}
                  onClick={() => add(catalogLabel(i), i)}
                  title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{catalogLabel(i)}</span>}
                  subtitle={typeof i.attributes?.gaugeMm === 'number' ? `${i.attributes.gaugeMm.toFixed(2)}mm` : undefined}
                />
              ))}
            </div>
          )}
          {full && <p className="field-error" role="alert">{t('shelf.full', { max: MAX_OFFERED })}</p>}
          {addOpen && (
            <button type="button" className="link-quiet link-quiet--flush" style={{ alignSelf: 'flex-end' }} onClick={() => { setDraft(''); setFull(false); setAddOpen(false); }}>
              {t('shelf.addDone')}
            </button>
          )}
        </div>
      )}
      {!showAdd && full && <p className="field-error" role="alert">{t('shelf.full', { max: MAX_OFFERED })}</p>}

      {ready && shelf.strings.length === 0 && <EmptyState icon="format_list_bulleted">{t('shelf.empty')}</EmptyState>}

      {/* SEARCH + FILTERS — a large shelf only; they stick under the top bar. */}
      {ready && large && (
        <div className="shelf-tools" ref={toolsRef}>
          <label className="shelf-search">
            <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('shelf.search')}
              aria-label={t('shelf.search')}
              enterKeyHint="search"
            />
            {query !== '' && (
              <button type="button" className="shelf-search-clear" aria-label={t('shelf.searchClear')} onClick={() => setQuery('')}>
                <span className="material-icons icon-xs" aria-hidden="true">close</span>
              </button>
            )}
          </label>
          <div className="filter-chips" role="group" aria-label={t('shelf.filters')}>
            {chips.map((c) => {
              const on = c.id === filterId(activeFilter);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  className={on ? 'filter-chip filter-chip--applied' : 'filter-chip'}
                  onClick={() => setFilter(on && c.filter.kind !== 'all' ? { kind: 'all' } : c.filter)}
                >
                  {chipLabel(c)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {ready && shelf.strings.length > 0 && (
        <div className="shelf-list">
          {groups.map((g) => {
            const foldable = large && !narrowed && FOLDED_BY_DEFAULT.has(g.status);
            const title = t(GROUP_LABEL[g.status], { count: g.count });
            const warn = NEEDS_YOU.has(g.status);
            return (
              <section key={g.status} className="shelf-group" aria-label={large ? title : undefined}>
                {foldable ? (
                  <button
                    type="button"
                    className={warn ? 'shelf-fold shelf-fold--warn' : 'shelf-fold'}
                    aria-expanded={!g.folded}
                    onClick={() => setOpened((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.status)) next.delete(g.status);
                      else next.add(g.status);
                      return next;
                    })}
                  >
                    <span className="section-label" style={{ flex: 1 }}>{title}</span>
                    {g.folded && <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{g.status === 'shelf' ? t('shelf.foldedFine') : t('shelf.folded')}</span>}
                    <span className="material-icons icon-sm motion-chevron" data-open={g.folded ? 'false' : 'true'} aria-hidden="true" style={{ color: 'var(--text-muted)' }}>expand_more</span>
                  </button>
                ) : large ? (
                  <span className={warn ? 'section-label shelf-group-label shelf-group-label--warn' : 'section-label shelf-group-label'}>{title}</span>
                ) : null}
                {g.entries.length > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="shelf-group">
                    {g.entries.map(renderRow)}
                  </ul>
                )}
              </section>
            );
          })}
          {groups.length === 0 && narrowed && (
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('shelf.noMatch', { query: query.trim() })}</p>
          )}
        </div>
      )}

      {/* NOT ON YOUR SHELF — stock bought under another name, then names the
          jobs used. Each can be counted as a shelf string without renaming. */}
      {ready && (offShelf.length > 0 || jobLabels.length > 0) && (
        <div className="flex flex-col gap-2" style={{ paddingTop: 'var(--space-2)' }}>
          <span className="section-label-muted">{t('shelf.offShelf')}</span>
          {offShelf.map((l) => (
            <ListRow
              key={l.label}
              onClick={() => openSheet('offShelf', l.label)}
              ariaLabel={t('shelf.openRow', { name: l.label })}
              title={<span className="fs-md" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{l.label}</span>}
              subtitle={t('shelf.offShelfStock', { count: l.remainingSets })}
              trailing={<span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>}
            />
          ))}
          {jobLabels.length > 0 && (
            <>
              <button
                type="button"
                className="bpm-row-link"
                aria-expanded={jobsOpen}
                onClick={() => setJobsOpen((v) => !v)}
              >
                <span className="fs-sm" style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                  {t('shelf.offShelfJobs', { count: jobLabels.reduce((n, u) => n + u.usedSets, 0) })}
                </span>
                <span className="material-icons icon-sm motion-chevron" data-open={jobsOpen ? 'true' : 'false'} aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
                  expand_more
                </span>
              </button>
              <Collapse open={jobsOpen}>
                <div className="flex flex-col gap-2">
                  {jobLabels.map((u) => (
                    <ListRow
                      key={u.label}
                      onClick={() => openSheet('jobLabel', u.label)}
                      ariaLabel={t('shelf.openRow', { name: u.label })}
                      title={<span className="fs-md" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{u.label}</span>}
                      subtitle={t('shelf.rackets', { count: u.usedSets })}
                      trailing={<span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>}
                    />
                  ))}
                </div>
              </Collapse>
            </>
          )}
        </div>
      )}

      {sheet && shelf && stock && (
        <StringShelfSheet
          key={sheet.n}
          open
          onClose={closeSheet}
          mode={sheet.mode}
          label={sheetLabel}
          busy={busy}
          online={online}
          error={saveError}
          price={shelf.prices[sheetLabel]}
          line={sheetLine}
          // Exactly the purchases the stock math counted on this line.
          purchases={stock.purchases.filter((p) => (sheetLine?.purchaseIds ?? []).includes(p.id))}
          linkedId={shelf.links[sheetLabel] ?? null}
          linked={shelf.links[sheetLabel] ? catalog.items.find((i) => i.id === shelf.links[sheetLabel]) ?? null : null}
          catalog={catalog.items}
          catalogState={catalog.loadError ? 'failed' : catalog.loaded ? 'ready' : 'loading'}
          aliasesHere={Object.entries(shelf.aliases).filter(([, to]) => to === sheetLabel).map(([from]) => from)}
          offered={shelf.strings}
          jobCount={jobLabels.find((u) => u.label === sheetLabel)?.usedSets ?? 0}
          onLogPurchase={() => {
            closeSheet();
            setPurchase((p) => ({ label: sheetLabel, n: (p?.n ?? 0) + 1 }));
          }}
          onRemovePurchase={(id) => void removePurchase(id)}
          onLink={(item) => void save({ links: { ...shelf.links, [sheetLabel]: item.id } })}
          onRemoveAlias={(from) => {
            const next = { ...shelf.aliases };
            delete next[from];
            void save({ aliases: next });
          }}
          onRemove={() => {
            void save({ strings: shelf.strings.filter((s) => s !== sheetLabel) }).then((ok) => ok && closeSheet());
          }}
          onAlias={(target) => {
            void save({ aliases: { ...shelf.aliases, [sheetLabel]: target } }).then((ok) => ok && closeSheet());
          }}
          colours={shelf.colours[sheetLabel] ?? []}
          customColours={shelf.customColours}
          clubCombos={clubCombos(shelf.colours)}
          note={shelf.notes[sheetLabel] ?? ''}
          onSave={(edits) => {
            void saveSheet(sheetLabel, edits).then((ok) => ok && closeSheet());
          }}
          renameError={renameError}
          onOffer={() => {
            // Closes either way: a refused add (a full shelf) is said on the
            // card, under the add field, which is where the sheet returns to.
            add(sheetLabel, null, false);
            closeSheet();
          }}
        />
      )}

      {purchase && shelf && (
        <StringPurchaseSheet
          key={purchase.n}
          open
          onClose={() => setPurchase(null)}
          onSaved={() => void loadStock().catch(() => setLoadError(true))}
          initialLabel={purchase.label}
          offered={shelf.strings.map((label) => ({
            label,
            item: shelf.links[label] ? catalog.items.find((i) => i.id === shelf.links[label]) ?? null : null,
            colours: shelf.colours[label] ?? [],
          }))}
          customColours={shelf.customColours}
        />
      )}
    </div>
  );
}
