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

/**
 * A LANDED answer reused while nothing has been written since (2026-11-05).
 *
 * Opening the app asked the server 35 times, about ten of them twice: Home
 * read the session, the roster, the release notes and the member, and the
 * tabs opened behind the launch screen a second later read them again —
 * after the first answers had landed, so the in-flight share above never saw
 * them (measured on a production build, 4× slowed CPU, 150 ms round trips).
 *
 * The reason there was no tail stands: a refetch right after a write must go
 * to the server. So the tail is WRITE-AWARE. `watchWrites()` (installed once
 * by the app shell) counts every non-GET request the page makes; an answer is
 * reused only within `SETTLED_SHARE_MS` of landing AND only while that count
 * has not moved since the request STARTED — a sign-up, a payment, a PIN
 * change, anything, and the next read goes to the server. Without the watch
 * (a test, a page that never installs it) nothing is reused past the flight.
 * Only an ok answer is kept; a 4xx or 5xx is never handed to a later caller.
 */
const SETTLED_SHARE_MS = 8000;

let writeEpoch = 0;
let watchedFetch: typeof fetch | null = null;

/** Count the page's writes, so a settled answer is never reused across one. Idempotent. */
export function watchWrites(): void {
  if (typeof window === 'undefined' || (watchedFetch && window.fetch === watchedFetch)) return;
  const inner = window.fetch.bind(window);
  const wrapped: typeof fetch = (input, init) => {
    const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') writeEpoch++;
    return inner(input, init);
  };
  window.fetch = wrapped;
  watchedFetch = wrapped;
}

/** A write this module cannot see (a beacon, a form post): drop every settled answer. */
export function noteWrite(): void {
  writeEpoch++;
}

/** The watch is installed and still the page's fetch (a test may have replaced it). */
function writesWatched(): boolean {
  return typeof window !== 'undefined' && watchedFetch !== null && window.fetch === watchedFetch;
}

type Settled = { at: number; epoch: number; promise: Promise<Response> };
const settled = new Map<string, Settled>();

function takeSettled(path: string): Promise<Response> | null {
  const hit = settled.get(path);
  if (!hit) return null;
  if (!writesWatched() || hit.epoch !== writeEpoch || Date.now() - hit.at >= SETTLED_SHARE_MS) {
    settled.delete(path);
    return null;
  }
  return hit.promise;
}

type Entry = { at: number; promise: Promise<unknown> };

const inflight = new Map<string, Entry>();

const inflightFetches = new Map<string, Promise<Response>>();

/**
 * A read started early for a card that is not mounted yet, handed to the
 * first `sharedFetch` of that path and then forgotten.
 *
 * Home's balance and skill cards mount only once the week's reads have
 * landed, so their own reads used to START then: a second wave behind the
 * first (trace of 2026-10-24: the week landed at 1.6s, the balance at 2.3s).
 * Home primes them beside the week's reads instead. One-shot, so a refetch
 * after a payment goes to the server; `PRIMED_MS` drops one nobody took (the
 * week failed and the card never mounted).
 */
const PRIMED_MS = 5000;

const primed = new Map<string, Entry & { promise: Promise<Response> }>();

export function primeFetch(path: string): void {
  if (primed.has(path)) return;
  const promise = fetch(`${BASE}${path}`, { cache: 'no-store' });
  // The taker sees a rejection; an untaken one must not surface as unhandled.
  promise.catch(() => {});
  primed.set(path, { at: Date.now(), promise });
}

function takePrimed(path: string): Promise<Response> | null {
  const hit = primed.get(path);
  if (!hit) return null;
  primed.delete(path);
  return Date.now() - hit.at < PRIMED_MS ? hit.promise : null;
}

/** Test seam: a suite that asserts on fetch counts must start from nothing. */
export function resetSharedReads(): void {
  inflight.clear();
  inflightFetches.clear();
  primed.clear();
  settled.clear();
}

/**
 * One GET while it is IN FLIGHT, however many callers — and nothing after.
 *
 * The sibling of `sharedRead` for callers that keep their own `Response`
 * handling: Home's shell and tab both ask for `/api/session` on mount, the
 * tab and the avatar store both ask for `/api/members`, every
 * `useCurrentGroup()` instance asks for both group endpoints, and the admin
 * landing's cards each ask for the session and its roster — and, in that
 * same commit, the Needs-you card and the stat tiles both ask for
 * `/api/members` and `/api/birds`, and the Needs-you card and the bench
 * menu row both ask for `/api/stringing/jobs`. Each caller gets its own
 * clone of the one response, so a 404 is still a 404 to the caller that
 * knows what a 404 means on its screen.
 *
 * No BLIND freshness tail, on purpose. These callers also refetch right after
 * a mutation (a sign-up, a paid toggle, a cover), and even a two-second
 * window could hand the refetch the answer from before the write. The one
 * tail there is (`SETTLED_SHARE_MS`) is void the moment the page writes
 * anything, so a refetch after a write always goes to the server.
 */
export function sharedFetch(path: string): Promise<Response> {
  let promise = inflightFetches.get(path) ?? takeSettled(path) ?? undefined;
  if (!promise) {
    const epoch = writeEpoch;
    const started = takePrimed(path) ?? fetch(`${BASE}${path}`, { cache: 'no-store' });
    promise = started;
    inflightFetches.set(path, started);
    const done = () => {
      if (inflightFetches.get(path) === started) inflightFetches.delete(path);
    };
    started.then((r) => {
      done();
      // Kept for a later caller only when ok, and only under the write watch.
      if (r.ok && typeof r.clone === 'function' && writesWatched()) settled.set(path, { at: Date.now(), epoch, promise: started });
    }, done);
  }
  // A body reads once; every sharer takes a clone and the original stays
  // unread. (A test double without `clone` is handed back as is.)
  return promise.then((r) => (typeof r.clone === 'function' ? r.clone() : r));
}

export function sharedRead<T = unknown>(path: string): Promise<T> {
  const now = Date.now();
  const hit = inflight.get(path) as (Entry & { epoch?: number }) | undefined;
  // The same write-aware tail as `sharedFetch`, beyond the blind two seconds.
  const fresh = hit && (now - hit.at < FRESH_MS || (writesWatched() && hit.epoch === writeEpoch && now - hit.at < SETTLED_SHARE_MS));
  if (hit && fresh) return hit.promise as Promise<T>;
  const epoch = writeEpoch;

  const promise = fetch(`${BASE}${path}`, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
  inflight.set(path, { at: now, epoch, promise } as Entry);
  // A failure is never shared past its own settle: the next mount must be able
  // to try again rather than inherit someone else's error.
  promise.catch(() => {
    if (inflight.get(path)?.promise === promise) inflight.delete(path);
  });
  return promise as Promise<T>;
}
