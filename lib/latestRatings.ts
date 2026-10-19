import { getContainer, ensureContainer } from './cosmos';
import type { Rating } from './assessment';

/**
 * Every member's LATEST self-assessment, memoized for the whole process.
 *
 * `GET /api/stats/club/bands` (Stats, on every open; Home too, for a member
 * with no history) folds the club's ratings into medians. It read EVERY
 * assessment ever stored, ratings arrays included, on every request — a
 * cross-partition scan of a container that grows with each check-in
 * (performance audit, 2026-10-19). The answer changes only when someone checks
 * in, so this keeps the fold and lets the writers clear it, the same shape as
 * the level calibration in `lib/levelStore.ts`.
 *
 * - The TTL is checked BEFORE any read, and the in-flight PROMISE is what is
 *   stored, so ten Stats opens landing together pay for one scan.
 * - A failed read is dropped at once: the next request tries again rather
 *   than being handed the error for a minute.
 * - `invalidateLatestRatings()` is called by `POST /api/assessments` (a new
 *   check-in) and by `purgeMember` (a deleted account's ratings must leave the
 *   club's medians now, not in a minute).
 * - The fold is of EVERY row, `name:` subjects included. Who may count — the
 *   roster, the viewer, never an invented name — is the caller's rule
 *   (`stats/club/bands`), applied to the fold on each request.
 *
 * ONLY against real Cosmos, like the session-pointer memo in `lib/cosmos.ts`:
 * the mock store is wiped between tests (and by a dev reseed), and a memo
 * there would hand one test the last one's club.
 *
 * In-process, so a second App Service instance would keep its own copy for up
 * to the TTL after a check-in on the other (registered in
 * `__tests__/single-instance-registry.test.ts`). Production runs one.
 */

export interface LatestRating {
  takenAt: string;
  ratings: Rating[];
}

const TTL_MS = 60_000;

const ratingsCache = new Map<'all', { at: number; promise: Promise<Map<string, LatestRating>> }>();

async function readLatest(): Promise<Map<string, LatestRating>> {
  await ensureContainer('assessments', '/memberId');
  const { resources } = await getContainer('assessments')
    .items.query({ query: 'SELECT c.memberId, c.takenAt, c.ratings FROM c' })
    .fetchAll();
  const latest = new Map<string, LatestRating>();
  for (const doc of resources as Array<{ memberId?: unknown; takenAt?: unknown; ratings?: unknown }>) {
    if (!doc || typeof doc.memberId !== 'string' || typeof doc.takenAt !== 'string') continue;
    if (!Array.isArray(doc.ratings)) continue;
    const seen = latest.get(doc.memberId);
    if (seen && seen.takenAt >= doc.takenAt) continue;
    latest.set(doc.memberId, { takenAt: doc.takenAt, ratings: doc.ratings as Rating[] });
  }
  return latest;
}

/** Latest ratings per `memberId` (real or `name:` subject). Do not mutate the result. */
export function latestRatingsByMember(): Promise<Map<string, LatestRating>> {
  if (!process.env.COSMOS_CONNECTION_STRING) return readLatest();
  const hit = ratingsCache.get('all');
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = readLatest();
  const entry = { at: Date.now(), promise };
  ratingsCache.set('all', entry);
  promise.catch(() => {
    if (ratingsCache.get('all') === entry) ratingsCache.delete('all');
  });
  return promise;
}

/** Forget the fold: the next read scans again. Called by every assessment writer and deleter. */
export function invalidateLatestRatings(): void {
  ratingsCache.clear();
}
