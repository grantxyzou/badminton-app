'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
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
import { catalogLabel, matches, purchasesFor } from '@/lib/shelfEdit';
import type { CatalogItem, StringPurchase } from '@/lib/types';
import StringShelfSheet, { type ShelfSheetMode } from './StringShelfSheet';
import StringPurchaseSheet from './StringPurchaseSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Stock = StringStockSummary & { purchases: StringPurchase[]; aliases?: Record<string, string> };
interface Shelf {
  strings: string[];
  links: Record<string, string>;
  prices: Record<string, number | null>;
  aliases: Record<string, string>;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;

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
        setShelf({
          strings: d.strings,
          links: d.links && typeof d.links === 'object' ? d.links : {},
          prices: d.prices && typeof d.prices === 'object' ? d.prices : {},
          aliases: s.aliases && typeof s.aliases === 'object' ? s.aliases : {},
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, loadStock]);

  /** Save the shelf. Optimistic with rollback, then re-count the stock, which is keyed by the list. */
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
        body: JSON.stringify(merged),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (Array.isArray(d.strings)) {
        setShelf({ strings: d.strings, links: d.links ?? {}, prices: d.prices ?? {}, aliases: d.aliases ?? {} });
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

  function add(label = draft.trim(), item: CatalogItem | null = null) {
    if (!label || !shelf) return;
    setDraft('');
    const existing = shelf.strings.find((s) => s.toLowerCase() === label.toLowerCase());
    if (existing) {
      if (item && shelf.links[existing] !== item.id) void save({ links: { ...shelf.links, [existing]: item.id } });
      return;
    }
    if (shelf.strings.length >= MAX_OFFERED) return;
    void save({ strings: [...shelf.strings, label], links: item ? { ...shelf.links, [label]: item.id } : shelf.links });
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
  const totals = stock?.totals;
  const subtitle =
    totals && (totals.usedSets > 0 || totals.purchasedCostCents > 0)
      ? t('shelf.subtitle', { value: money(totals.remainingValueCents), used: totals.usedSets })
      : t('shelf.subtitleEmpty');
  const suggestions = ready ? matches(catalog.items, draft.trim()) : [];

  const openSheet = (mode: ShelfSheetMode, label: string) => setSheet((s) => ({ mode, label, n: (s?.n ?? 0) + 1 }));
  const closeSheet = () => setSheet(null);
  const sheetLabel = sheet?.label ?? '';
  const sheetLine = sheet ? (sheet.mode === 'jobLabel' ? null : lineFor(sheetLabel)) : null;

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="inventory_2" title={t('shelf.title')} subtitle={subtitle} />

      {saveError && <ErrorState message={t('strings.saveError')} />}

      {ready && shelf.strings.length === 0 && <EmptyState icon="format_list_bulleted">{t('shelf.empty')}</EmptyState>}

      {ready && shelf.strings.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
          {shelf.strings.map((label) => {
            const line = lineFor(label);
            const hasStock = !!line && line.purchases > 0;
            const low = hasStock && line.remainingSets <= LOW_STOCK_SETS;
            const price = shelf.prices[label];
            return (
              <li key={label}>
                <ListRow
                  onClick={() => openSheet('offered', label)}
                  ariaLabel={t('shelf.openRow', { name: label })}
                  title={<span className="fs-md" style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{label}</span>}
                  subtitle={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: low ? 'var(--sev-warn)' : undefined }}>
                      {low && <span className="material-icons icon-xs" aria-hidden="true">warning</span>}
                      {hasStock ? t('shelf.setsLeft', { count: line.remainingSets }) : t('shelf.noStock')}
                    </span>
                  }
                  trailing={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', flex: '0 0 auto' }}>
                      {/* A figure in the data face; the absence of one in plain
                          muted text, so "No price" never reads as a number. */}
                      {label in shelf.prices ? (
                        <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {formatServicePrice(price ?? null) ?? t('strings.priceAsk')}
                        </span>
                      ) : (
                        <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('shelf.noPrice')}</span>
                      )}
                      <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>
                    </span>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* ADD — catalog matches for what is typed; Enter adds it as typed. */}
      {suggestions.length > 0 && (
        <div role="listbox" aria-label={t('strings.matches')} className="flex flex-col gap-1">
          {suggestions.map((i) => (
            <button
              key={i.id}
              type="button"
              role="option"
              aria-selected={false}
              className="cc-mini-card fs-sm"
              style={{ textAlign: 'left', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
              disabled={busy || !online}
              onClick={() => add(catalogLabel(i), i)}
            >
              {catalogLabel(i)}
              {typeof i.attributes?.gaugeMm === 'number' && <span style={{ color: 'var(--text-muted)' }}>{` · ${i.attributes.gaugeMm.toFixed(2)}mm`}</span>}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
        />
        <button type="button" onClick={() => add()} disabled={busy || !online || !draft.trim() || !ready} className="cc-btn cc-btn-secondary">
          {t('strings.add')}
        </button>
      </div>

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
          price={shelf.prices[sheetLabel]}
          line={sheetLine}
          purchases={purchasesFor(sheetLabel, stock.purchases, shelf.aliases, shelf.links[sheetLabel] ?? null, shelf.strings)}
          linked={shelf.links[sheetLabel] ? catalog.items.find((i) => i.id === shelf.links[sheetLabel]) ?? null : null}
          catalog={catalog.items}
          aliasesHere={Object.entries(shelf.aliases).filter(([, to]) => to === sheetLabel).map(([from]) => from)}
          offered={shelf.strings}
          jobCount={jobLabels.find((u) => u.label === sheetLabel)?.usedSets ?? 0}
          onSavePrice={(cents) => void save({ prices: { ...shelf.prices, [sheetLabel]: cents } })}
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
          onOffer={() => {
            closeSheet();
            add(sheetLabel);
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
          }))}
        />
      )}
    </div>
  );
}
