'use client';

import { useEffect, useState } from 'react';
import GearPickCard, { type GearPick, type GearPickCardStatus } from './GearPickCard';
import type { UseGear } from './useGear';
import type { CatalogItem, EquipmentCategory } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Rail order per the artboard caption — not the same order as `SOURCED`. */
const ORDER: EquipmentCategory[] = ['racket', 'shoe', 'string', 'shuttle'];

/** Categories `/api/recommend` can actually score today
 *  (`ENGINE_CATEGORIES` in `app/api/recommend/route.ts`). Shoe and shuttle
 *  have no engine and no catalog rows, so they render straight to the parked
 *  card with zero fetches — the rail issues one fetch per SOURCED category,
 *  never one per rail slot. */
const SOURCED: EquipmentCategory[] = ['racket', 'string'];

interface CategoryState {
  status: GearPickCardStatus;
  pick: GearPick | null;
}

function initialState(): Record<EquipmentCategory, CategoryState> {
  const state = {} as Record<EquipmentCategory, CategoryState>;
  for (const cat of ORDER) {
    state[cat] = SOURCED.includes(cat) ? { status: 'loading', pick: null } : { status: 'parked', pick: null };
  }
  return state;
}

export interface GearPickRailProps {
  activeName: string | null;
  gear: UseGear;
}

/**
 * The artboard's category rail — one card per equipment category, each
 * showing what the member owns beside what `/api/recommend` would suggest.
 *
 * Replaces `GearRail`, which only ever showed a category description; this
 * rail shows an actual scored pick and flips to "In your kit" the moment the
 * member already owns it — the prototype's live bug (recommending back gear
 * the member already has) that this redesign exists to fix.
 *
 * Ownership is read from the `gear` prop (the single owner of the gear
 * document — see `useGear`'s docstring), never from a second fetch: a
 * per-card gear read here would recreate the exact drift bug the register is
 * being restructured to eliminate.
 */
export default function GearPickRail({ activeName, gear }: GearPickRailProps) {
  const [state, setState] = useState<Record<EquipmentCategory, CategoryState>>(initialState);

  useEffect(() => {
    if (!activeName) return;
    let live = true;
    for (const cat of SOURCED) {
      fetch(`${BASE}/api/recommend?name=${encodeURIComponent(activeName)}&category=${cat}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
          if (!live) return;
          // `unavailable` is the parked state regardless of which of the two
          // reasons the route gave — the rail deliberately does not
          // distinguish 'no_engine' from 'no_catalog'. A ready response with
          // no item (e.g. `needsCheckIn`) renders through the same parked
          // card in GearPickCard (`status === 'parked' || !pick`).
          if (d.unavailable || !d.item) {
            setState((prev) => ({ ...prev, [cat]: { status: 'parked', pick: null } }));
            return;
          }
          setState((prev) => ({
            ...prev,
            [cat]: {
              status: 'ready',
              pick: { item: d.item as CatalogItem, reasons: Array.isArray(d.reasons) ? d.reasons : [] },
            },
          }));
        })
        // A non-ok response (flag off, forbidden, load failure) is "unknown",
        // not "known parked" — it must render the distinct error card per the
        // legible-fail rule, never a confident coming-soon.
        .catch(() => {
          if (live) setState((prev) => ({ ...prev, [cat]: { status: 'error', pick: null } }));
        });
    }
    return () => {
      live = false;
    };
  }, [activeName]);

  if (!activeName) return null;

  function isOwned(category: EquipmentCategory, item: CatalogItem | null): boolean {
    if (!item) return false;
    const items = gear.gear?.items ?? [];
    return items.some(
      (i) => i && !i.retiredAt && (i.category ?? 'racket') === category && i.catalogId === item.id,
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-4)',
        // Bleed to the column edges so the rail reads as scrollable rather
        // than as cards that happen to be cut off — matches GearRail.
        margin: '0 -16px',
        padding: '2px 16px 6px',
        overflowX: 'auto',
        scrollSnapType: 'x proximity',
        scrollbarWidth: 'none',
      }}
    >
      {ORDER.map((cat) => {
        const { status, pick } = state[cat];
        return (
          <GearPickCard
            key={cat}
            category={cat}
            pick={pick}
            owned={isOwned(cat, pick?.item ?? null)}
            status={status}
            // Task 5 wires this to the detail sheet (GearPickSheet); this
            // task only builds the rail and card, which is unmounted until
            // GearRegister adopts it.
            onOpen={() => {}}
          />
        );
      })}
    </div>
  );
}
