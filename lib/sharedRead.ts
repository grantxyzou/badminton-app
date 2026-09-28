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

const inflightFetches = new Map<string, Promise<Response>>();

/** Test seam: a suite that asserts on fetch counts must start from nothing. */
export function resetSharedReads(): void {
  inflight.clear();
  inflightFetches.clear();
}

/**
 * One GET while it is IN FLIGHT, however many callers — and nothing after.
 *
 * The sibling of `sharedRead` for callers that keep their own `Response`
 * handling: Home's shell and tab both ask for `/api/session` on mount, the
 * tab and the avatar store both ask for `/api/members`, every
 * `useCurrentGroup()` instance asks for both group endpoints, and the admin
 * landing's cards each ask for the session and its roster. Each caller gets
 * its own clone of the one response, so a 404 is still a 404 to the caller
 * that knows what a 404 means on its screen.
 *
 * NO freshness tail, on purpose. These callers also refetch right after a
 * mutation (a sign-up, a paid toggle, a cover), and even a two-second window
 * could hand the refetch the answer from before the write. Sharing only
 * while the request is open cannot: a refetch that starts after the write
 * finds nothing in flight and goes to the server.
 */
export function sharedFetch(path: string): Promise<Response> {
  let promise = inflightFetches.get(path);
  if (!promise) {
    promise = fetch(`${BASE}${path}`, { cache: 'no-store' });
    inflightFetches.set(path, promise);
    const done = () => {
      if (inflightFetches.get(path) === promise) inflightFetches.delete(path);
    };
    promise.then(done, done);
  }
  // A body reads once; every sharer takes a clone and the original stays
  // unread. (A test double without `clone` is handed back as is.)
  return promise.then((r) => (typeof r.clone === 'function' ? r.clone() : r));
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
