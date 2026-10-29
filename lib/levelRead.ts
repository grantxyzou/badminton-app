/**
 * The client's reading of `GET /api/stats/level` (`docs/plans/one-level.md`).
 *
 * "Your level" is the canonical level everywhere it appears — Home's skill
 * lead, the Stats LEVEL tile, the "Your level over time" chart — and every
 * "since …" change is the difference between two points of its trail, so the
 * change always adds up to the numbers on screen. Those three surfaces each
 * read the level through here; none re-derives it from raw check-ins.
 */

/** One point of `CanonicalLevel.trail`: the level as of a check-in. */
export interface TrailPoint { at: string; level: number }

/** What a surface needs from the level read. */
export interface LevelRead { level: number | null; trail: TrailPoint[] }

export const levelPath = (name: string) => `/api/stats/level?name=${encodeURIComponent(name)}`;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The response body, read defensively: a missing or malformed trail is an
 *  empty one, never a crash, and points without a usable level or date drop. */
export function parseLevelRead(body: unknown): LevelRead {
  const raw = (body as { level?: { level?: unknown; trail?: unknown } } | null)?.level;
  const level = isNum(raw?.level) ? raw.level : null;
  const trail = Array.isArray(raw?.trail)
    ? (raw.trail as Array<{ at?: unknown; level?: unknown }>)
        .filter((p): p is TrailPoint => typeof p?.at === 'string' && isNum(p?.level))
        .map((p) => ({ at: p.at, level: p.level }))
    : [];
  return { level, trail };
}

/** The change since the previous check-in, or null with fewer than two points. */
export function lastChange(trail: TrailPoint[]): { delta: number; since: string } | null {
  if (trail.length < 2) return null;
  const latest = trail[trail.length - 1];
  const previous = trail[trail.length - 2];
  return { delta: latest.level - previous.level, since: previous.at };
}
