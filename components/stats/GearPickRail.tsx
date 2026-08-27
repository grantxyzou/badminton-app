'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { recordEngagement } from '@/lib/engagement';
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

function initialStatuses(): Record<EquipmentCategory, GearPickCardStatus> {
  const statuses = {} as Record<EquipmentCategory, GearPickCardStatus>;
  for (const cat of ORDER) statuses[cat] = SOURCED.includes(cat) ? 'loading' : 'parked';
  return statuses;
}

export interface GearPickRailProps {
  activeName: string | null;
  gear: UseGear;
  /**
   * D2: reports the tension the STRING pairing arrived at, or null when it
   * could not give one (parked, errored, or a frame with no published
   * ceiling). `GearRegister` uses it to stand `StringTensionCard` down, so the
   * register never shows the pair-specific number and the level-based one at
   * the same time.
   *
   * A callback rather than a second fetch in the card: this rail already owns
   * the string pick, and a card that re-asked would recreate the multi-reader
   * drift the register was restructured to remove.
   */
  onPairTension?: (lbs: number | null) => void;
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
export default function GearPickRail({ activeName, gear, onPairTension }: GearPickRailProps) {
  const [state, setState] = useState<Record<EquipmentCategory, CategoryState>>(initialState);
  // Which category's detail sheet is open. The rail owns this, not the card:
  // the sheet is opened FROM a card but belongs to the rail, which is the only
  // place that holds both the pick and the gear owner needed to add it.
  const [openCategory, setOpenCategory] = useState<EquipmentCategory | null>(null);

  // Mirror of each category's status, kept in step with `setState` so the fetch
  // effect can consult it without taking `state` as a dependency (which would
  // make every response retrigger the effect that produced it).
  const statusRef = useRef<Record<EquipmentCategory, GearPickCardStatus>>(initialStatuses());

  // Held in a ref so a caller passing an inline arrow doesn't re-run the fetch
  // effect on every render. Written in an effect rather than during render:
  // a ref mutated mid-render is a React correctness bug (the render may be
  // discarded), and `useRef`'s initial value already covers the first pass.
  const onPairTensionRef = useRef(onPairTension);
  useEffect(() => {
    onPairTensionRef.current = onPairTension;
  }, [onPairTension]);

  const apply = useCallback((cat: EquipmentCategory, next: CategoryState) => {
    statusRef.current[cat] = next.status;
    setState((prev) => ({ ...prev, [cat]: next }));
    if (cat === 'string') {
      onPairTensionRef.current?.(next.status === 'ready' ? next.pick?.tensionLbs ?? null : null);
    }
  }, []);

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
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeName || recKey === null) return;
    // First pass vs. a preference change. On a refresh, skip only the PARKED
    // categories: parked is a property of the catalog and the engine, not of
    // your budget, so re-asking cannot change the answer — and `string` is
    // parked on every request today, so that alone is half of each refetch
    // pass, burnt against /api/recommend's 10/min/IP limit whose throttled
    // response is precisely the one that renders as an error card.
    //
    // Every other status IS re-asked, `loading` included. Skipping a
    // still-in-flight category would strand it forever: this effect's previous
    // run has already had its cleanup fire (`live = false`), discarding the
    // response that was going to settle it, so it would sit on CardSkeleton
    // permanently — a fifth state, and not one of the four honest ones.
    const isRefresh = prevKeyRef.current !== null && prevKeyRef.current !== recKey;
    prevKeyRef.current = recKey;

    let live = true;
    for (const cat of SOURCED) {
      if (isRefresh && statusRef.current[cat] === 'parked') continue;
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
            apply(cat, { status: 'parked', pick: null });
            return;
          }
          if (!d.item) {
            apply(cat, { status: 'error', pick: null });
            return;
          }
          apply(cat, {
            status: 'ready',
            pick: {
              item: d.item as CatalogItem,
              // Two response shapes, not one. Only the engine paths return a
              // `reasons` array; the non-recommender path (route.ts:311, the
              // one bpm-stable always takes because deploy-stable.yml sets
              // NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER 'false') returns a singular
              // `reason` string. Reading only the array threw that away and
              // left the pick sheet — whose entire job is explaining one
              // recommendation — with a heading and an Add button and no why.
              reasons: Array.isArray(d.reasons)
                ? d.reasons
                : (typeof d.reason === 'string' && d.reason ? [d.reason] : []),
              warnings: Array.isArray(d.warnings) ? d.warnings : [],
              pairedWith: d.pairedWith ?? undefined,
              tensionLbs: typeof d.tensionLbs === 'number' ? d.tensionLbs : null,
            },
          });
        })
        // A non-ok response (flag off, forbidden, load failure) is "unknown",
        // not "known parked" — it must render the distinct error card per the
        // legible-fail rule, never a confident coming-soon.
        .catch(() => {
          if (live) apply(cat, { status: 'error', pick: null });
        });
    }
    return () => {
      live = false;
    };
  }, [activeName, recKey, apply]);

  if (!activeName) return null;

  /**
   * Ownership, but only ever asked when the answer is KNOWN.
   *
   * `useGear` sets `loadError: true` AND `loaded: true` on a failed read, so a
   * bag that could not be read is indistinguishable here from an empty one:
   * every category would answer "not owned", the IN YOUR KIT badge would drop,
   * and the rail would recommend back the racket already in the member's bag —
   * the prototype bug this redesign exists to fix. So the caller must gate on
   * `gear.loadError` first (see `railStatus`) and never render a `false` from
   * this function as a fact.
   */
  function isOwned(category: EquipmentCategory, item: CatalogItem | null): boolean {
    if (!item) return false;
    const items = gear.gear?.items ?? [];
    return items.some(
      (i) => i && !i.retiredAt && (i.category ?? 'racket') === category && i.catalogId === item.id,
    );
  }

  /**
   * A card that HAS a pick cannot be drawn while ownership is unknown — the
   * badge is half of what the card says. It degrades to the card's existing
   * error state ("Couldn't load your kit"), which is exactly the failure.
   *
   * Parked categories (shoe, shuttle) are deliberately untouched: their state
   * is a statement about the recommendation engine, not about the member's
   * bag, and is still perfectly true when the gear read fails. Turning a
   * genuinely-known state into a failure is the same defect in the other
   * direction.
   */
  function railStatus(status: GearPickCardStatus, pick: GearPick | null): GearPickCardStatus {
    return gear.loadError && pick ? 'error' : status;
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
        margin: '0 calc(-1 * var(--space-5))',
        padding: 'var(--space-05) var(--space-5) var(--space-2)',
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
            status={railStatus(status, pick)}
            onOpen={() => {
              setOpenCategory(cat);
              // The Value-Hub Slice-0 kill-criterion ("did a member interact
              // more than once") had exactly one writer: RacketRecCard's
              // disclosure tap. This tap replaces it, and the `events`
              // container is append-only — a gap in the series is
              // indistinguishable afterwards from real disengagement. Same
              // `rec_card_tap` kind so the series stays continuous.
              // Fire-and-forget by design; nothing on screen depends on it.
              void recordEngagement('rec_card_tap');
            }}
          />
        );
      })}
    </div>

    {/* One sheet, driven by which card was tapped — the same "one picker"
        principle as YourKitCard's GearSheet. It takes the rail's `gear`, so
        adding from it flips this card to IN YOUR KIT and fills the kit row in
        the same pass, with no reload and no second fetch.

        `open` keys off the tapped CATEGORY, never off whether a pick is
        currently resolved. The pick is live — changing format or budget inside
        the sheet refetches it — and gating the sheet's existence on that would
        let it evaporate under the member's finger the moment a refetch came
        back empty (a throttled response is the easy way to hit that). A sheet
        that vanishes with no explanation is the sheet-shaped version of the
        lying empty state; GearPickSheet renders an error instead. */}
    <GearPickSheet
      open={openCategory !== null}
      onClose={() => setOpenCategory(null)}
      category={openCategory ?? 'racket'}
      pick={openPick}
      owned={isOwned(openCategory ?? 'racket', openPick?.item ?? null)}
      gear={gear}
    />
    </>
  );
}
