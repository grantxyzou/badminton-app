import type { PlayerGear } from '@/lib/types';

/**
 * The last bag each name read or wrote in THIS page load (`useGear`).
 *
 * The Stats register switch remounts the Gear register every time Equipment
 * is opened (`key={view}`), so the card used to start from a skeleton and a
 * fresh round trip on every visit (Grant, 2026-11-05: "this app is getting
 * really slow"). It now draws the bag it last had at once and re-reads behind
 * it — the "a refetch keeps its content" rule across a remount. Page memory
 * only: signing in or out reloads the page, so it never outlives the person.
 *
 * Its own file, with no React in it, so the suite can reset it before every
 * test (`__tests__/setup/reset-page-memory.ts`).
 */
const lastBag = new Map<string, PlayerGear | null>();

export function rememberedBag(name: string | null): { known: boolean; bag: PlayerGear | null } {
  if (name === null || !lastBag.has(name)) return { known: false, bag: null };
  return { known: true, bag: lastBag.get(name) ?? null };
}

export function rememberBag(name: string, bag: PlayerGear | null): void {
  lastBag.set(name, bag);
}

/** Test seam. */
export function resetGearMemory(): void {
  lastBag.clear();
}
