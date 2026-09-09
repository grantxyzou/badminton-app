'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { recordEngagement } from '@/lib/engagement';
import GearPickCard, { type GearPick, type GearPickCardStatus, type ParkReason, type PickReasonKey } from './GearPickCard';
import GearPickSheet from './GearPickSheet';
import type { UseGear } from './useGear';
import { PROFILE_READS_FIT } from '@/lib/racketProfile';
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

/**
 * How long a preference change waits before re-asking `/api/recommend`. The
 * fit sheet has five controls and a member answering it for the first time
 * taps them in a row; every tap used to be a fetch per sourced category
 * against a 10/min/IP limit whose throttled 200 renders as an error card.
 * Half a second collapses a burst into one pass. Only a change that leaves
 * format and budget alone is delayed: the first pass and a format/budget tap
 * refetch at once.
 */
export const REC_REFETCH_DEBOUNCE_MS = 500;

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
  /** Opens the fit questionnaire, which `GearRegister` owns — it has to be
   *  reachable from the kit card as well as from a READY racket pick, or a
   *  member whose racket card is parked or errored could never clear a
   *  stored comfort answer. The rail closes its own sheet first. */
  onOpenFit?: () => void;
  /** True while the fit questionnaire is open. A fit-driven refetch is HELD
   *  until it closes: answered at a human pace, five controls were eleven
   *  `/api/recommend` calls inside a minute against a 10/min limit whose
   *  throttled 200 renders as an error card, and the card is under the sheet
   *  anyway. Format/budget changes (made from the pick sheet) are unaffected. */
  holdFitRefetch?: boolean;
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
export default function GearPickRail({ activeName, gear, onPairTension, onOpenFit, holdFitRefetch = false }: GearPickRailProps) {
  const t = useTranslations('stats.gear');
  // Reason KEYS are translated HERE, in the member's locale — the point of the
  // fit engine speaking in keys. The server's English strings are the
  // fallback for the legacy engine, which still speaks in sentences.
  const say = useCallback((keys: PickReasonKey[] | undefined, fallback: string[]): string[] => {
    if (!Array.isArray(keys) || keys.length === 0) return fallback;
    return keys.map((k) => t(k.key, k.params as Record<string, string | number>));
  }, [t]);
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
  // Three keys, because three things read them differently. Format/budget
  // reach both engines. The fit answers reach the racket engine (and the
  // string pick only through the frame it pairs against). The string budget
  // reaches the PAIRING engine only. The last two are gated on
  // `PROFILE_READS_FIT`: until an engine reads a field, re-asking on it burns
  // the 10/min/IP limiter on an identical answer, and a throttled 200 renders
  // as an error card. The gate lives next to `buildProfile` so the rail and
  // the server cannot disagree about which fields matter.
  const d = gear.gear;
  const prefKey = gearLoaded ? `${d?.playFormat ?? ''}|${d?.budgetMaxCad ?? ''}` : null;
  const fitKey = gearLoaded && PROFILE_READS_FIT
    ? `${d?.fitGoal ?? ''}|${d?.fitSwing ?? ''}|${d?.fitArmComfort ?? ''}|${d?.fitGrip ?? ''}`
    : '';
  // `stringBudgetMaxCad` is deliberately NOT a key: no engine reads it yet
  // (see PROFILE_READS_FIT's docstring), so a refetch on it returns the same
  // pick for a limiter token.
  const recKey = prefKey === null ? null : `${prefKey}#${fitKey}`;
  const prevKeyRef = useRef<string | null>(null);
  // Whether the string pick is paired against the member's OWN racket, as the
  // SERVER reported it (`pairedWith.source`), never as a client mirror of the
  // server's rule. The mirror drifted twice: it counted a free-text racket as
  // a fixed frame, and it counted a catalogId the catalog no longer resolves.
  // Only a string paired with an owned frame can be skipped on a fit change —
  // any other string is paired against the RECOMMENDED frame, which the fit
  // answers move.
  const stringSourceRef = useRef<'owned' | 'recommended' | null>(null);
  // Categories whose in-flight fetch this effect's cleanup discarded. They are
  // never skipped by the next run: the answer on screen is the one from
  // BEFORE the change that cancelled them, and skipping would leave it there.
  const inFlightRef = useRef(new Set<EquipmentCategory>());
  const cancelledRef = useRef(new Set<EquipmentCategory>());
  // Why each parked category parked. Only `no_engine` is a property of the app
  // and safe to skip on a refresh; every other park (`needsFit`,
  // `needsCheckIn`, `no_catalog` from having no frame) depends on this
  // member's answers and must be re-asked when they change — a string parked
  // with "no frame" un-parks the moment the racket engine can recommend one.
  const parkReasonRef = useRef<Record<EquipmentCategory, ParkReason | null>>({} as Record<EquipmentCategory, ParkReason | null>);
  const [parkReasons, setParkReasons] = useState<Partial<Record<EquipmentCategory, ParkReason | null>>>({});

  // A different member is a different rail. Every ref above describes the
  // previous member's picks, and the skip rules would otherwise serve their
  // string pick (or their parked card) to whoever signs in next on a shared
  // device.
  const prevNameRef = useRef(activeName);
  useEffect(() => {
    if (prevNameRef.current === activeName) return;
    prevNameRef.current = activeName;
    statusRef.current = initialStatuses();
    parkReasonRef.current = {} as Record<EquipmentCategory, ParkReason | null>;
    setParkReasons({});
    stringSourceRef.current = null;
    prevKeyRef.current = null;
    cancelledRef.current.clear();
    inFlightRef.current.clear();
    setState(initialState());
  }, [activeName]);

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
    const prev = prevKeyRef.current;
    const isRefresh = prev !== null && prev !== recKey;
    const [prevPref, prevFit] = (prev ?? '#').split('#');
    const [nextPref, nextFit] = recKey.split('#');
    const prefChanged = isRefresh && prevPref !== nextPref;
    // (`prevFit !== nextFit` is implied by isRefresh && !prefChanged.)
    void prevFit; void nextFit;
    // Held while the fit sheet is open. `prevKeyRef` does not advance, so the
    // effect re-runs when the hold lifts and sees the same change.
    if (isRefresh && !prefChanged && holdFitRefetch) return;
    // A re-run with NO key change (the hold prop toggling) is not a first
    // pass: it asks nothing — except whatever the previous run's cleanup just
    // cancelled, which would otherwise be stranded.
    const noChange = !isRefresh && prev !== null;
    if (noChange && cancelledRef.current.size === 0) return;

    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      // The key advances only when a pass actually RUNS. Advancing it at
      // schedule time meant a debounced pass that was then cleared left the
      // next diff comparing against a key nothing ever fetched — a swing tap
      // followed inside 500 ms by a string-budget tap skipped the racket for
      // good, with the pre-swing pick still on screen.
      prevKeyRef.current = recKey;
      for (const cat of SOURCED) {
        // Consumed BEFORE the parked skip, or a stale entry survives it.
        const cancelled = cancelledRef.current.delete(cat);
        if (noChange && !cancelled) continue;
        if (isRefresh && !cancelled && statusRef.current[cat] === 'parked' && parkReasonRef.current[cat] === 'no_engine') continue;
        if (isRefresh && !cancelled) {
          // A string already paired with the member's OWN frame cannot move
          // on a fit-only change; any other string is paired with the
          // recommended frame, which can.
          if (cat === 'string' && !prefChanged
            && statusRef.current.string === 'ready' && stringSourceRef.current === 'owned') continue;
        }
        inFlightRef.current.add(cat);
        fetch(`${BASE}/api/recommend?name=${encodeURIComponent(activeName)}&category=${cat}`, { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((d) => {
            if (!live) return;
            inFlightRef.current.delete(cat);
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
            if (d.unavailable || d.needsCheckIn || d.needsFit) {
              const reason: ParkReason = d.unavailable === 'no_engine' ? 'no_engine'
                : d.unavailable ? 'no_catalog'
                : d.needsFit ? 'needsFit' : 'needsCheckIn';
              parkReasonRef.current[cat] = reason;
              setParkReasons((prev) => ({ ...prev, [cat]: reason }));
              apply(cat, { status: 'parked', pick: null });
              return;
            }
            if (!d.item) {
              apply(cat, { status: 'error', pick: null });
              return;
            }
            if (cat === 'string') stringSourceRef.current = d.pairedWith?.source ?? null;
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
                reasons: say(d.reasonKeys, Array.isArray(d.reasons)
                  ? d.reasons
                  : (typeof d.reason === 'string' && d.reason ? [d.reason] : [])),
                warnings: say(d.warningKeys, Array.isArray(d.warnings) ? d.warnings : []),
                reasonKeys: Array.isArray(d.reasonKeys) ? d.reasonKeys : undefined,
                warningKeys: Array.isArray(d.warningKeys) ? d.warningKeys : undefined,
                alternatives: Array.isArray(d.alternatives)
                  ? d.alternatives.map((a: { item: CatalogItem; reasons?: string[]; reasonKeys?: PickReasonKey[]; differsBy?: PickReasonKey[]; differsByText?: string[] }) => ({
                      item: a.item,
                      reasons: say(a.reasonKeys, Array.isArray(a.reasons) ? a.reasons : []),
                      reasonKeys: a.reasonKeys,
                      differsBy: Array.isArray(a.differsBy) ? a.differsBy : [],
                      differsByText: say(a.differsBy, Array.isArray(a.differsByText) ? a.differsByText : []),
                    }))
                  : undefined,
                fitState: typeof d.fitState === 'string' ? d.fitState : undefined,
                engineVersion: typeof d.engineVersion === 'string' ? d.engineVersion : undefined,
                pairedWith: d.pairedWith ?? undefined,
                tensionLbs: typeof d.tensionLbs === 'number' ? d.tensionLbs : null,
              },
            });
          })
          // A non-ok response (flag off, forbidden, load failure) is "unknown",
          // not "known parked" — it must render the distinct error card per the
          // legible-fail rule, never a confident coming-soon.
          .catch(() => {
            if (!live) return;
            inFlightRef.current.delete(cat);
            apply(cat, { status: 'error', pick: null });
          });
      }
    };
    // Only a fit-sheet burst is debounced (see REC_REFETCH_DEBOUNCE_MS). A
    // single format or budget tap in the pick sheet refetches at once, as it
    // always did — the pick under that sheet must not sit stale for half a
    // second with no loading state to say so.
    if (isRefresh && !prefChanged) timer = setTimeout(run, REC_REFETCH_DEBOUNCE_MS);
    else run();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      // Whatever was still in flight is now discarded; the next run must
      // re-ask it whatever its status, or the old answer stays on screen.
      for (const cat of inFlightRef.current) cancelledRef.current.add(cat);
      inFlightRef.current.clear();
    };
  }, [activeName, recKey, apply, holdFitRefetch, say]);

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
            parkReason={status === 'parked' ? (parkReasons[cat] ?? (SOURCED.includes(cat) ? null : 'no_engine')) : null}
            onOpenFit={onOpenFit}
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
      // One sheet at a time. The pick sheet closes and the questionnaire opens
      // in its place; when that closes the member is back on the rail, whose
      // racket card has re-asked with the new answers. Stacking the two would
      // put a form over the answer it changes. (The 220 ms overlap of the two
      // body-scroll locks during the swap is handled by the lock itself,
      // which is reference-counted for exactly this.)
      onOpenFit={onOpenFit ? () => { setOpenCategory(null); onOpenFit(); } : undefined}
    />
    </>
  );
}
