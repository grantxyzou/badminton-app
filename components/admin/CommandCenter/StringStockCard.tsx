'use client';

import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import EmptyState from '@/components/primitives/EmptyState';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import Collapse from '@/components/primitives/Collapse';
import { useCatalog } from '@/components/stats/useCatalog';
import { useOnline } from '@/lib/useOnline';
import type { StringStockSummary } from '@/lib/stringStockMath';
import type { StringPurchase } from '@/lib/types';
import StringPurchaseSheet from './StringPurchaseSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Stock = StringStockSummary & { purchases: StringPurchase[] };

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * String inventory (docs/plans/string-inventory.md): what the club bought,
 * what went onto rackets, what it cost. The string half of the Birds page,
 * on the bench where the strings are chosen. Usage is COUNTED from jobs —
 * a job moved to "strung" is one set of its string — so the only thing to
 * log here is a purchase. Admin surface: English by decision.
 */
export default function StringStockCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const online = useOnline();
  const catalog = useCatalog('string');
  const [stock, setStock] = useState<Stock | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sheetOpening, setSheetOpening] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/stock`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as Partial<Stock>;
      // A response without the summary's shape is a failed read, not an empty stock.
      if (!Array.isArray(d.lines) || !Array.isArray(d.purchases) || !d.totals) throw new Error('shape');
      setStock(d as Stock);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt, refreshKey]);

  async function remove(id: string) {
    setDeleting(id);
    setDeleteError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/stock?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      await load();
    } catch {
      setDeleteError(true);
    } finally {
      setDeleting(null);
    }
  }

  const title = 'String stock';
  if (loadError) {
    return (
      <StateCard tone="danger" icon="inventory_2" title={title} message={<>Couldn&apos;t load the string stock. <StateLink onClick={() => setAttempt((n) => n + 1)}>Try again</StateLink></>}>
        <PreviewRow width="52%" />
        <PreviewRow width="38%" />
      </StateCard>
    );
  }

  const offered = (stock?.lines ?? []).map((l) => ({ label: l.label, item: l.catalogId ? catalog.items.find((i) => i.id === l.catalogId) ?? null : null }));
  const t = stock?.totals;
  // One subtitle while unread and while empty: the card's shape is its own
  // placeholder, so no interim wording is needed (the loading rule).
  const subtitle = !stock
    ? 'What you bought, what went onto rackets, what it cost.'
    : t && (t.usedSets > 0 || t.purchasedCostCents > 0)
      ? `${t.usedSets} set${t.usedSets === 1 ? '' : 's'} used · ${money(t.usedCostCents)} of string on rackets · ${money(t.remainingValueCents)} on the shelf`
      : 'What you bought, what went onto rackets, what it cost.';

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="inventory_2" title={title} subtitle={subtitle} />

      {stock && stock.lines.length === 0 && stock.unmatched.length === 0 && (
        <EmptyState icon="format_list_bulleted">Add the strings you stock above, then log a reel or a pack here.</EmptyState>
      )}

      {stock && stock.lines.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
          {stock.lines.map((l) => (
            <li key={l.label} className="cc-mini-card" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'baseline' }}>
                <span className="fs-md" style={{ color: 'var(--text-primary)' }}>{l.label}</span>
                <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', color: l.purchasedMetres > 0 && l.remainingSets <= 3 ? 'var(--sev-warn)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  {l.purchasedMetres > 0 ? `${l.remainingSets} set${l.remainingSets === 1 ? '' : 's'} left` : 'no stock logged'}
                </span>
              </div>
              <div className="fs-sm" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-05)' }}>
                {l.usedSets} used{l.costPerSetCents !== null ? ` · ${money(l.costPerSetCents)} a racket · ${money(l.usedCostCents ?? 0)} used so far` : ''}
                {l.purchasedMetres > 0 ? ` · ${l.remainingMetres} of ${l.purchasedMetres} m` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {stock && stock.unmatched.length > 0 && (
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
          Not on your list: {stock.unmatched.map((u) => `${u.label} (${u.usedSets})`).join(', ')}. Add the name above, spelled the way the jobs have it, and they count.
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <button type="button" className="cc-btn cc-btn-primary" disabled={!online || !stock} onClick={() => { setSheetOpening((n) => n + 1); setSheetOpen(true); }}>
          Log purchase
        </button>
        {stock && stock.purchases.length > 0 && (
          <button type="button" className="cc-btn cc-btn-ghost" aria-expanded={logOpen} onClick={() => setLogOpen((v) => !v)}>
            {logOpen ? 'Hide purchases' : `Purchases (${stock.purchases.length})`}
          </button>
        )}
      </div>

      {stock && (
        <Collapse open={logOpen}>
          {deleteError && <p className="field-error" role="alert">Couldn&apos;t remove that purchase — try again.</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
            {stock.purchases.map((p) => (
              <li key={p.id} className="fs-sm" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', color: 'var(--text-secondary)' }}>
                <span>
                  <span style={{ color: 'var(--text-primary)' }}>{p.label}</span> · {p.units} {p.unit}{p.units === 1 ? '' : 's'} × {p.metresPerUnit} m · {money(p.totalCostCents)} · {day(p.date)}
                  {p.notes ? ` · ${p.notes}` : ''}
                </span>
                <button type="button" className="cc-btn cc-btn-ghost" disabled={!online || deleting === p.id} onClick={() => void remove(p.id)} aria-label={`Remove ${p.label} purchase from ${day(p.date)}`}>
                  <span className="material-icons icon-sm" aria-hidden="true">delete_outline</span>
                </button>
              </li>
            ))}
          </ul>
        </Collapse>
      )}

      <StringPurchaseSheet key={sheetOpening} open={sheetOpen} onClose={() => setSheetOpen(false)} onSaved={() => void load()} offered={offered} />
    </div>
  );
}
