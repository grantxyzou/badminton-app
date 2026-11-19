'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ListRow from '@/components/primitives/ListRow';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import RacketThumb from '@/components/stats/RacketThumb';
import { useCatalog } from '@/components/stats/useCatalog';
import { useGear } from '@/components/stats/useGear';
import { searchCatalog } from '@/lib/gearSearch';
import { isOffered } from '@/lib/catalogOffer';
import { racketSpecLine } from '@/lib/gearSetup';
import { gearFailureMessage } from '@/lib/gearFailureMessage';
import type { CatalogItem } from '@/lib/types';

/** Rows drawn before the member narrows the list: the catalog is long, and
 *  a name typed in the search finds any of it. */
const MAX_ROWS = 30;

/**
 * "What racket do you play with?" — the strings map's strip, for a member
 * with no racket in their equipment yet (docs/plans/map-racket-choice.md;
 * Grant, 2026-11-19: "the strip should ask for me what am I using then it can
 * make a recommendation").
 *
 * A tap ADDS the racket to the member's equipment as the one in play: the
 * same write as Stats → Equipment (`useGear().add`), so there is one bag and
 * one racket in play, and the map then glows for it. Catalog rackets only: a
 * racket typed by name has no frame to pair a string against, and Equipment
 * is where one is typed.
 *
 * Mounted by the card only once it is first opened, so the Strings register
 * reads no gear doc for a member who never taps the strip. It is the
 * register's ONE `useGear`.
 */
export default function MapRacketAskSheet({
  open,
  onClose,
  name,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  /** The member's name in this club, which the gear write is keyed by. */
  name: string;
  /** The racket is in the bag and in play: the map can be read again. */
  onAdded: () => void;
}) {
  const t = useTranslations('home.stringing.offer');
  const tHub = useTranslations('valueHub');
  const catalog = useCatalog('racket');
  const gear = useGear(name);
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const offered = useMemo(
    () => catalog.items.filter(isOffered).slice().sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`)),
    [catalog.items],
  );
  const matches = useMemo(
    () => (query.trim() ? searchCatalog(offered, query, (c) => `${c.brand} ${c.model}`) : offered),
    [offered, query],
  );
  const shown = matches.slice(0, MAX_ROWS);

  async function pick(item: CatalogItem) {
    if (pendingId) return;
    setPendingId(item.id);
    setError(null);
    const res = await gear.add(item, { makeActive: true });
    setPendingId(null);
    // Already in the bag is the answer we wanted, by another road.
    if (res.ok || res.reason === 'duplicate_racket') onAdded();
    else setError(gearFailureMessage(res.reason, tHub));
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('askRacketTitle')}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('close')}>
        <span className="bpm-h3" style={{ margin: 0 }}>{t('askRacketTitle')}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col gap-3">
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('askRacketHint')}</p>
          <div className="sheet-search">
            <span className="material-icons" aria-hidden="true">search</span>
            <input
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('askRacketSearch')}
              aria-label={t('askRacketSearch')}
            />
            {query && (
              <button type="button" className="sheet-search-clear" onClick={() => setQuery('')} aria-label={t('askRacketClear')}>
                <span className="material-icons" aria-hidden="true">close</span>
              </button>
            )}
          </div>
          {/* The save failed: said next to the list it came from. */}
          {error && <p className="field-warn" role="alert" style={{ margin: 0 }}>{error}</p>}
          {catalog.loadError ? (
            <ErrorState message={t('askRacketLoadError')} />
          ) : !catalog.loaded ? (
            <div aria-hidden="true" className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((n) => <div key={n} className="shimmer-line" style={{ height: 'var(--space-9)', borderRadius: 'var(--radius-lg)' }} />)}
            </div>
          ) : shown.length === 0 ? (
            <EmptyState icon="search">{t('askRacketNoMatch')}</EmptyState>
          ) : (
            <>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
                {shown.map((item) => (
                  <li key={item.id} aria-busy={pendingId === item.id || undefined}>
                    <ListRow
                      onClick={() => { void pick(item); }}
                      // Offline or mid-save, a tap could only fail or double up.
                      disabled={gear.busy || pendingId !== null}
                      leading={<RacketThumb catalogId={item.id} />}
                      title={<span className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.brand} {item.model}</span>}
                      subtitle={racketSpecLine(item) ?? undefined}
                    />
                  </li>
                ))}
              </ul>
              {matches.length > shown.length && (
                <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('askRacketMore', { count: matches.length - shown.length })}</p>
              )}
            </>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
