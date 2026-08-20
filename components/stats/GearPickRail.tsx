'use client';

import { useEffect, useState } from 'react';
import GearPickCard, { type GearPick, type GearPickCardStatus } from './GearPickCard';
import GearPickSheet from './GearPickSheet';
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
  // Which category's detail sheet is open. The rail owns this, not the card:
  // the sheet is opened FROM a card but belongs to the rail, which is the only
  // place that holds both the pick and the gear owner needed to add it.
  const [openCategory, setOpenCategory] = useState<EquipmentCategory | null>(null);

  // The engine reads `playFormat` and `budgetMaxCad` off the gear doc, and
  // `GearPickSheet` is where they are now edited — so a change there must
  // refetch the pick, or the controls would only take effect after a reload.
  //
  // Deliberately NOT keyed on the bag: adding the recommended item is supposed
  // to flip the card to IN YOUR KIT, and re-scoring on bag change would swap
  // the pick out from under the flip this redesign exists to deliver.
  //
  // Null until the gear read settles, which also gates the fetch below. Firing
  // once on `null` and again on `loaded` would double every pass against a
  // 10/min rate limit whose throttled response has no `unavailable` field —
  // i.e. it would render as an error card (see the ladder below).
  const gearLoaded = gear.loaded;
  const recKey = gearLoaded
    ? `${gear.gear?.playFormat ?? ''}|${gear.gear?.budgetMaxCad ?? ''}`
    : null;

  useEffect(() => {
    if (!activeName || recKey === null) return;
    let live = true;
    for (const cat of SOURCED) {
      fetch(`${BASE}/api/recommend?name=${encodeURIComponent(activeName)}&category=${cat}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
          if (!live) return;
          // The ladder, in order:
          //
          //   `unavailable`  → parked, regardless of which of the two reasons
          //                    the route gave. The rail deliberately does not
          //                    distinguish 'no_engine' from 'no_catalog'.
          //   `needsCheckIn` → parked. A ready response with no item because
          //                    the member hasn't self-assessed yet is an
          //                    honest "nothing to recommend", not a failure.
          //   an `item`      → ready.
          //   none of those  → ERROR, never parked. `/api/recommend`'s
          //                    rate-limit branch returns a bare
          //                    `{item: null, reason: null}` with a 200 and no
          //                    `unavailable` field, so a throttled member
          //                    would otherwise see a confident "Coming soon"
          //                    for a live category. A failure must never
          //                    render as a product state.
          if (d.unavailable || d.needsCheckIn) {
            setState((prev) => ({ ...prev, [cat]: { status: 'parked', pick: null } }));
            return;
          }
          if (!d.item) {
            setState((prev) => ({ ...prev, [cat]: { status: 'error', pick: null } }));
            return;
          }
          setState((prev) => ({
            ...prev,
            [cat]: {
              status: 'ready',
              pick: {
                item: d.item as CatalogItem,
                reasons: Array.isArray(d.reasons) ? d.reasons : [],
                warnings: Array.isArray(d.warnings) ? d.warnings : [],
              },
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
  }, [activeName, recKey]);

  if (!activeName) return null;

  function isOwned(category: EquipmentCategory, item: CatalogItem | null): boolean {
    if (!item) return false;
    const items = gear.gear?.items ?? [];
    return items.some(
      (i) => i && !i.retiredAt && (i.category ?? 'racket') === category && i.catalogId === item.id,
    );
  }

  const openPick = openCategory ? state[openCategory].pick : null;

  return (
    <>
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
            onOpen={() => setOpenCategory(cat)}
          />
        );
      })}
    </div>

    {/* One sheet, driven by which card was tapped — the same "one picker"
        principle as YourKitCard's GearSheet. It takes the rail's `gear`, so
        adding from it flips this card to IN YOUR KIT and fills the kit row in
        the same pass, with no reload and no second fetch. */}
    <GearPickSheet
      open={openCategory !== null && openPick !== null}
      onClose={() => setOpenCategory(null)}
      category={openCategory ?? 'racket'}
      pick={openPick}
      owned={isOwned(openCategory ?? 'racket', openPick?.item ?? null)}
      gear={gear}
    />
    </>
  );
}
