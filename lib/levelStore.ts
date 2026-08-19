/**
 * Server-only I/O for the canonical level. EVERY consumer (API route, insight
 * narrator, future gear rec) goes through `getCanonicalLevel` so the number is
 * computed one way. Pure math lives in `lib/level.ts` / `lib/calibration.ts`;
 * this file only fetches.
 *
 * Reads mirror the established patterns:
 *  - assessments by `memberId` with a JS-side filter (the mock store ignores
 *    `@memberId`), same as `fetchAssessmentTrend` in the insight route.
 *  - `Member.stage` by id (real members only).
 *  - Phase 2: the WHOLE group's games + self-seeds, folded once into observed
 *    levels — everyone's rating depends on everyone's, so it's one fold shared
 *    by every viewer. Cached briefly in-process (critique I): the result is
 *    identical for all callers until a new game or check-in lands, so a 30s TTL
 *    keyed on a cheap signature avoids recomputing on every Stats load.
 *
 * Failures are non-fatal: a read error degrades a source to absent rather than
 * throwing, so the level still derives from whatever survived.
 */

import { getContainer, ensureContainer } from './cosmos';
import { isFlagOn } from './flags';
import { deriveLevel, type CanonicalLevel } from './level';
import { calibrateRatings, type CalGame, type CalSeed, type PlayerCalibration } from './calibration';

/** Subject identity, as resolved by the route (`resolveSubject` shape). */
export interface LevelSubject {
  /** Real `members` id, or a `name:<lower>` fallback for non-members. */
  memberId: string;
  name: string;
}

async function fetchSelfSnapshots(memberId: string): Promise<{ takenAt: string; overall: number | null }[]> {
  try {
    await ensureContainer('assessments', '/memberId');
    const { resources } = await getContainer('assessments').items
      .query({
        query: 'SELECT c.memberId, c.takenAt, c.overall FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: memberId }],
      })
      .fetchAll();
    return (resources as { memberId?: string; takenAt?: string; overall?: number | null }[])
      .filter((d) => d && d.memberId === memberId && typeof d.takenAt === 'string')
      .map((d) => ({ takenAt: d.takenAt as string, overall: typeof d.overall === 'number' ? d.overall : null }));
  } catch (err) {
    console.error('level: assessment read failed:', err);
    return [];
  }
}

/** `Member.stage` for a real member id, else null. */
async function fetchLegacyStage(memberId: string): Promise<number | null> {
  if (memberId.startsWith('name:')) return null;
  try {
    const { resource } = await getContainer('members').item(memberId, memberId).read<{ stage?: number }>();
    return typeof resource?.stage === 'number' ? resource.stage : null;
  } catch {
    return null;
  }
}

/** All games across all sessions (cross-partition), trimmed to what the fold
 *  needs. Empty on any failure (calibration simply contributes nothing). */
async function fetchAllGames(): Promise<CalGame[]> {
  try {
    await ensureContainer('gameResults', '/sessionId');
    const { resources } = await getContainer('gameResults').items
      .query({ query: 'SELECT c.teamA, c.teamB, c.scoreA, c.scoreB, c.loggedAt FROM c' })
      .fetchAll();
    return (resources as CalGame[]).filter((g) => g && Array.isArray(g.teamA) && Array.isArray(g.teamB));
  } catch (err) {
    console.error('level: games read failed:', err);
    return [];
  }
}

/**
 * Self-seeds for the fold: each player's LATEST self-assessment overall, keyed
 * by lowercased name. Also returns the newest `takenAt` for cache-signing.
 *
 * **Name-derived subjects are excluded** (issue #250). `POST /api/assessments`
 * deliberately still accepts writes for a name with no member record, storing
 * them under `memberId = 'name:<lower>'` — and nobody has to authenticate to
 * make one. Since seeds join to the fold by lowercased NAME, such a document
 * would otherwise anchor the calibration of the real member who shares that
 * name. Two demonstrated consequences: writing ratings for a person before
 * they join moved their game basis 5 → 1.1 once they did, and seeding a
 * non-member who merely appears in `gameResults` shifted an existing member's
 * observed level, because the fold is group-wide.
 *
 * #249 closed the write path for names that ARE members; this closes the read
 * path for names that are not. Anonymous self-assessment still works — those
 * players keep their own level via `fetchSelfSnapshots`, which is keyed by
 * memberId. They simply no longer anchor anyone else's.
 *
 * **The join must stay name-based — do not "improve" `CalSeed` to carry
 * `memberId`.** `CalGame.teamA`/`teamB` are arrays of names (see
 * `GameResult`, written by `app/api/games/route.ts`); games carry no member id
 * at all. Keying seeds by memberId would match nothing and silently disable
 * every anchor. Closing the name/id split properly means migrating
 * `gameResults` first.
 */
async function fetchSeeds(): Promise<{ seeds: CalSeed[]; maxAt: string }> {
  try {
    await ensureContainer('assessments', '/memberId');
    const { resources } = await getContainer('assessments').items
      .query({ query: 'SELECT c.memberId, c.name, c.takenAt, c.overall FROM c' })
      .fetchAll();
    const latest = new Map<string, { takenAt: string; overall: number | null }>();
    let maxAt = '';
    for (const d of resources as { memberId?: string; name?: string; takenAt?: string; overall?: number | null }[]) {
      if (!d || typeof d.name !== 'string' || typeof d.takenAt !== 'string') continue;
      // Unauthenticated, name-derived subject — never an anchor. Mirrors the
      // same `startsWith('name:')` check `fetchLegacyStage` already uses.
      if (typeof d.memberId !== 'string' || d.memberId.startsWith('name:')) continue;
      // maxAt covers only documents that can actually change the result, so a
      // skipped write doesn't needlessly bust the group-calibration cache.
      if (d.takenAt > maxAt) maxAt = d.takenAt;
      const key = d.name.trim().toLowerCase();
      const cur = latest.get(key);
      if (!cur || d.takenAt > cur.takenAt) latest.set(key, { takenAt: d.takenAt, overall: typeof d.overall === 'number' ? d.overall : null });
    }
    const seeds: CalSeed[] = [...latest.entries()].map(([nameLower, v]) => ({ nameLower, selfLevel: v.overall }));
    return { seeds, maxAt };
  } catch (err) {
    console.error('level: seed read failed:', err);
    return { seeds: [], maxAt: '' };
  }
}

// ── In-process group-calibration cache (critique I) ──
const CAL_TTL_MS = 30_000;
let calCache: { sig: string; at: number; map: Map<string, PlayerCalibration> } | null = null;

/** The whole-group observed-level fold, memoized for CAL_TTL_MS. The signature
 *  changes when a game or check-in lands, busting the cache immediately. */
async function getGroupCalibration(now: string): Promise<Map<string, PlayerCalibration>> {
  const [games, { seeds, maxAt }] = await Promise.all([fetchAllGames(), fetchSeeds()]);
  const maxLogged = games.reduce((m, g) => (g.loggedAt > m ? g.loggedAt : m), '');
  const sig = `${games.length}:${maxLogged}:${seeds.length}:${maxAt}`;
  if (calCache && calCache.sig === sig && Date.now() - calCache.at < CAL_TTL_MS) {
    return calCache.map;
  }
  const map = calibrateRatings(games, seeds, now);
  calCache = { sig, at: Date.now(), map };
  return map;
}

/** Test seam — drop the memoized fold so cases don't bleed into each other. */
export function _resetCalibrationCache(): void {
  calCache = null;
}

/** The single entry point. Folds the member's self-assessments, legacy stage,
 *  and (Phase 2, flag-gated) the group's game calibration into one level. */
export async function getCanonicalLevel(subject: LevelSubject): Promise<CanonicalLevel> {
  const now = new Date().toISOString();
  const [selfSnapshots, legacyStage] = await Promise.all([
    fetchSelfSnapshots(subject.memberId),
    fetchLegacyStage(subject.memberId),
  ]);

  let gameCalibration: { observedLevel: number; games: number; lastGameAt: string | null } | null = null;
  if (isFlagOn('NEXT_PUBLIC_FLAG_SKILL_CALIBRATION')) {
    try {
      const group = await getGroupCalibration(now);
      const cal = group.get(subject.name.trim().toLowerCase());
      if (cal) gameCalibration = { observedLevel: cal.observedLevel, games: cal.games, lastGameAt: cal.lastGameAt };
    } catch (err) {
      console.error('level: calibration failed:', err);
    }
  }

  return deriveLevel({
    selfSnapshots,
    gameCalibration,
    legacyStage,
    smoothing: isFlagOn('NEXT_PUBLIC_FLAG_SKILL_SMOOTHING'),
    now,
  });
}
