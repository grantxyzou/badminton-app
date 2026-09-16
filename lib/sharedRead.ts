const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * One GET, however many cards ask for it.
 *
 * Three endpoints are read TWICE on a single screen, by two components that
 * mount together and each own their own state: `/api/stats/club/bands`
 * (`SkillTrendCard` + `WhereYouSitCard`), `/api/kudos` (`OverviewStrip` +
 * `KudosReceivedCard`) and `/api/games?all=true` (`OverviewStrip` +
 * `YourRecordCard`). On a phone that is three extra round trips on the
 * heaviest screen in the app.
 *
 * This is a DEDUPE, not a cache. An answer is shared only while the request is
 * still in flight, plus `FRESH_MS` after it lands — long enough to cover two
 * cards mounting a beat apart in the same commit, far too short to serve a
 * stale answer to a later visit. Nothing is held across a tab switch, a
 * pull-to-refresh or a mutation, so no caller has to remember to invalidate
 * anything — which is the failure mode a real cache would introduce here.
 *
 * Each caller still owns its own error handling: this resolves or rejects the
 * same way `fetch(...).then(json)` would, so a 403 stays a 403 for the card
 * that knows what a 403 means on that screen.
 */
const FRESH_MS = 2000;

type Entry = { at: number; promise: Promise<unknown> };

const inflight = new Map<string, Entry>();

/** Test seam: a suite that asserts on fetch counts must start from nothing. */
export function resetSharedReads(): void {
  inflight.clear();
}

export function sharedRead<T = unknown>(path: string): Promise<T> {
  const now = Date.now();
  const hit = inflight.get(path);
  if (hit && now - hit.at < FRESH_MS) return hit.promise as Promise<T>;

  const promise = fetch(`${BASE}${path}`, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
  inflight.set(path, { at: now, promise });
  // A failure is never shared past its own settle: the next mount must be able
  // to try again rather than inherit someone else's error.
  promise.catch(() => {
    if (inflight.get(path)?.promise === promise) inflight.delete(path);
  });
  return promise as Promise<T>;
}
