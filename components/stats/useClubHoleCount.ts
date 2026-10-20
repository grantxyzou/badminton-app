'use client';

import { useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The club stringer's grommet count for one frame (docs/plans/grommet-holes.md,
 * Phase 3), or null. Asked only when `enabled` — the frame page passes false
 * for a racket the maker or its pattern already answers for, so those pages
 * cost no request. It DECORATES the spec card, so a failed read degrades by
 * omission (the `useCatalog` rule for decorating consumers): the cell is
 * simply absent, as it is for a racket nobody has counted.
 */
export function useClubHoleCount(catalogId: string, enabled: boolean): number | null {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`${BASE}/api/stringing/holes`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && typeof d.counts === 'object' && d.counts) setCounts(d.counts); })
      .catch(() => {});
    return () => { live = false; };
  }, [enabled]);

  if (!enabled || !counts) return null;
  const n = counts[catalogId];
  return typeof n === 'number' ? n : null;
}
