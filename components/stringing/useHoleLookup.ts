'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadCatalog } from '@/components/stats/useCatalog';
import type { CatalogItem } from '@/lib/types';
import { racketIdForLabel, racketIdsByTallyKey } from '@/lib/gearSetup';
import { grommetHoles } from '@/lib/stringPatterns';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface JobHoles {
  /** The catalog racket the job's label names exactly, or null. */
  catalogId: string | null;
  /** Its hole count: the maker's or pattern's, else this club's own. */
  holes: number | null;
}

export interface HoleLookup {
  forLabel: (racketLabel: string) => JobHoles;
  /** Re-read the club's counts, after one was added on the Set-up screen. */
  reload: () => void;
}

/**
 * The hole count for a stringing job (docs/plans/grommet-holes.md, Phase 4),
 * matched from the job's racket LABEL at read time: nothing is stored on the
 * job. The one owner of that rule, shared by the bench, job detail and the
 * stringer's card, so the three cannot disagree. It decorates, so a failed
 * read shows no count rather than an error.
 *
 * `enabled: false` reads nothing at all: the stringer's card sits on every
 * member's Stringing tab, and a member with no assigned job must not pay for
 * the catalog and the counts.
 */
export function useHoleLookup(enabled = true): HoleLookup {
  const [rackets, setRackets] = useState<CatalogItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadCatalog('racket').then((items) => { if (live) setRackets(items); }).catch(() => {});
    return () => { live = false; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`${BASE}/api/stringing/holes`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && typeof d.counts === 'object' && d.counts) setCounts(d.counts); })
      .catch(() => {});
    return () => { live = false; };
  }, [attempt, enabled]);

  const ids = useMemo(() => racketIdsByTallyKey(rackets), [rackets]);
  const byId = useMemo(() => new Map(rackets.map((r) => [r.id, r])), [rackets]);

  const forLabel = useCallback((racketLabel: string): JobHoles => {
    const catalogId = racketIdForLabel(racketLabel, ids);
    const row = catalogId ? byId.get(catalogId) : undefined;
    if (!catalogId || !row) return { catalogId: null, holes: null };
    return { catalogId, holes: grommetHoles(row) ?? counts[catalogId] ?? null };
  }, [ids, byId, counts]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return useMemo(() => ({ forLabel, reload }), [forLabel, reload]);
}
