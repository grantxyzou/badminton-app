'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminBackHeader from './AdminBackHeader';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import type { CatalogGap } from '@/lib/catalogGaps';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** "Even ×2 · Stiff" — the most given answers first; a single answer has no count. */
function tally(counts: Partial<Record<string, number>>): string | null {
  const entries = Object.entries(counts).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0);
  if (entries.length === 0) return null;
  return entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([answer, n]) => (n > 1 ? `${answer} ×${n}` : answer))
    .join(' / ');
}

/**
 * Admin → Missing from the catalog. The rackets members typed in by name, most
 * common first, with who has each one and what they said it feels like — the
 * owner's list of models to add. A read failure is its own state, never an
 * empty list (the lying-empty-state rule).
 */
export default function CatalogGapsPage({ onBack }: { onBack: () => void }) {
  const [gaps, setGaps] = useState<CatalogGap[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/catalog-gaps`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setGaps(((await res.json()) as { gaps: CatalogGap[] }).gaps);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <AdminBackHeader onBack={onBack} title="Missing from the catalog" />
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
          Rackets members typed in by name because the catalog doesn&apos;t have them. Adding one to the catalog gives those
          members specs, a picture and a fit verdict.
        </p>
        {error && !gaps ? (
          <ErrorState
            message="Couldn't load the list."
            action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>Try again</button>}
          />
        ) : !gaps ? (
          <AdminPageSkeleton />
        ) : gaps.length === 0 ? (
          <EmptyState>Every racket in the club is in the catalog.</EmptyState>
        ) : (
          <ul className="glass-card is-flush catalog-gaps" style={{ listStyle: 'none', margin: 0, padding: 0, overflow: 'hidden' }}>
            {gaps.map((g) => {
              const feel = [tally(g.feel.balance), tally(g.feel.flex), tally(g.feel.weight)].filter(Boolean).join(' · ');
              return (
                <li key={g.label} className="catalog-gap">
                  <div className="catalog-gap-head">
                    <span className="catalog-gap-name">{g.label}</span>
                    <span className="catalog-gap-count">{g.count}</span>
                  </div>
                  {g.members.length > 0 && <p className="catalog-gap-line">{g.members.join(', ')}</p>}
                  {feel && <p className="catalog-gap-line">Feels: {feel}</p>}
                  {g.nearest && (g.nearest.likely
                    ? <p className="catalog-gap-line catalog-gap-likely">Probably the catalog&apos;s {g.nearest.label}, typed without picking it</p>
                    : <p className="catalog-gap-line catalog-gap-hint">Closest in the catalog: {g.nearest.label}</p>)}
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
