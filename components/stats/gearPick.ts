/**
 * The shape of one `/api/recommend` answer as the Gear register holds it.
 * These types lived on `GearPickCard` — the rail's card — which outlived the
 * flag-off register's retirement (2026-10-14) by a day as a 350-line component
 * nothing rendered, kept alive by the two files that imported its types.
 * `useGearPicks` and `GearPickSheet` read them from here now.
 */
import type { CatalogItem } from '@/lib/types';

/** A resolved recommendation for one category: the catalog row plus the
 *  why-this lines the engine produced for it. */
/** One reason as the fit engine emits it: an i18n key under `stats.gear`
 *  plus params. `useGearPicks` translates these at render, in the member's locale; the
 *  server's `reasons: string[]` is the English fallback for the legacy path. */
export interface PickReasonKey {
  key: string;
  params?: Record<string, string | number>;
}

export interface PickAlternative {
  item: CatalogItem;
  reasons: string[];
  reasonKeys?: PickReasonKey[];
  differsBy: PickReasonKey[];
  differsByText?: string[];
}

export interface GearPick {
  item: CatalogItem;
  reasons: string[];
  /** Fit-engine additions (Phase 2+). All optional so legacy picks type-check. */
  reasonKeys?: PickReasonKey[];
  warningKeys?: PickReasonKey[];
  alternatives?: PickAlternative[];
  fitState?: string;
  engineVersion?: string;
  /** Safety flags the engine raised about this pick (e.g. a weight warning).
   *  Optional so existing `GearPick` literals still type-check, but never
   *  optional to DISPLAY: `GearPickSheet` renders warnings uncollapsed. A card
   *  that hides a real warning is worse than a card that expands nothing. */
  warnings?: string[];
  /** Where this pick's performance numbers came from, when they are not the
   *  manufacturer's. Rendered in the muted caveat paragraph under the action,
   *  NOT with `warnings` — this is sourcing, not a safety flag, and only some
   *  catalog rows carry it. Absent means published. */
  provenance?: string;
  /** Which racket this pick was scored against, and whether the member owns
   *  it. String picks are pairings, not standalone recommendations — a string
   *  shown without the frame it assumed is advice for someone else's racket.
   *  Absent for categories scored against the player rather than a frame. */
  pairedWith?: { label: string; source: 'owned' | 'recommended' };
  /** Tension for THIS string on THAT frame, placed inside the pair's overlap
   *  window. Null when the frame publishes no ceiling — 11 of the 71 catalog
   *  rackets — in which case `StringTensionCard`'s level-based number stands
   *  in (spec D2). */
  tensionLbs?: number | null;
}

export type GearPickCardStatus = 'loading' | 'ready' | 'error' | 'parked';

/** Why a category parked. `no_engine` is a property of the app (shoes,
 *  shuttles); the rest depend on THIS member's data and can change. */
export type ParkReason = 'no_engine' | 'no_catalog' | 'needsCheckIn' | 'needsFit';
