'use client';

import { useEffect, useState } from 'react';
import type { CatalogItem, EquipmentCategory } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * One in-flight or settled catalog read per category for the life of the
 * page. The catalog is seeded data that changes with a deploy, not with a
 * tap, so the Set-up card and the sheets it opens share one read instead of
 * each asking again. A FAILED read is evicted so the next mount retries.
 */
const cache = new Map<EquipmentCategory, Promise<CatalogItem[]>>();

function load(category: EquipmentCategory): Promise<CatalogItem[]> {
  let p = cache.get(category);
  if (!p) {
    p = fetch(`${BASE}/api/equipment/catalog?category=${category}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => (d?.items ?? []) as CatalogItem[]);
    p.catch(() => cache.delete(category));
    cache.set(category, p);
  }
  return p;
}

/** Test seam: forget every cached read. */
export function resetCatalogCache() {
  cache.clear();
}

export interface UseCatalog {
  items: CatalogItem[];
  loaded: boolean;
  loadError: boolean;
}

/**
 * The catalog rows for one category. Consumers that only DECORATE with it
 * (the card's spec lines) degrade by omission on `loadError`; consumers whose
 * whole job it is (a picker) must render the error.
 */
export function useCatalog(category: EquipmentCategory): UseCatalog {
  const [state, setState] = useState<{ category: EquipmentCategory; items: CatalogItem[]; loaded: boolean; loadError: boolean }>(
    { category, items: [], loaded: false, loadError: false },
  );

  useEffect(() => {
    let live = true;
    load(category)
      .then((items) => { if (live) setState({ category, items, loaded: true, loadError: false }); })
      .catch(() => { if (live) setState({ category, items: [], loaded: true, loadError: true }); });
    return () => { live = false; };
  }, [category]);

  // A category switch shows nothing from the previous category, even for the
  // frame before the effect settles.
  return state.category === category
    ? { items: state.items, loaded: state.loaded, loadError: state.loadError }
    : { items: [], loaded: false, loadError: false };
}
