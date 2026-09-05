#!/usr/bin/env node
/**
 * Read-only smoke check for a running BPM deployment.
 *
 * WHY THIS EXISTS. Every push to `main` deploys to production, and because the
 * store shell is a WebView pointed at the live URL (`capacitor.config.ts` →
 * `server.url`), that deploy is simultaneously a native update on every phone
 * that has the app installed. There is no store review between a bad commit
 * and everyone's home screen. Nothing used to assert the deployment came back.
 *
 * STRICTLY READ-ONLY, and that is a hard constraint, not a preference. This
 * runs against PRODUCTION with real members' data. It performs GETs only: no
 * sign-in, no POST, and no JS execution — `recordEngagement()` is a client
 * beacon, so a browser here would write `events` rows and inflate the
 * Value-Hub Slice-0 metric, which asks whether a member interacted more than
 * once. A monitoring script must never become a participant.
 *
 * Usage:
 *   node scripts/smoke-prod.mjs                          # prod, no build gate
 *   node scripts/smoke-prod.mjs --sha <git-sha>          # wait for THIS build
 *   node scripts/smoke-prod.mjs --base http://localhost:3100/bpm --skip-well-known --mock
 *
 * Exit 0 = healthy. Exit 1 = a named, printed failure.
 */

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const BASE = (opt('base', 'https://bpm.grantzou.com/bpm')).replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const WANT_SHA = opt('sha');
const SKIP_WELL_KNOWN = has('skip-well-known');
// CI builds have no Cosmos, so the app runs on the in-memory mock store. The
// session endpoint must still answer, but `_rid` is the thing that PROVES real
// Cosmos and the mock deliberately never writes it — so demanding it there
// would fail every PR, and relaxing it everywhere would give up the one check
// that catches a production misconfiguration.
const MOCK = has('mock');

// Azure cold start after a deploy is 10-20s, and the swap itself is not
// instant. Generous, because a flaky red teaches people to ignore reds.
// Overridable so tests can prove the give-up path without waiting three
// minutes for it; production always uses the default.
const DEADLINE_MS = Number(opt('deadline', '180000'));
const POLL_MS = Number(opt('poll', '5000'));

const failures = [];
let checks = 0;

function pass(what) {
  checks += 1;
  console.log(`PASS  ${what}`);
}

function fail(what, detail, body = '') {
  checks += 1;
  failures.push({ what, detail, body });
  console.error(`FAIL  ${what}\n      ${detail}`);
  // The red X gets read on a phone. Enough body to diagnose, not enough to
  // bury the reason.
  if (body) console.error(`      body: ${body.slice(0, 300).replace(/\s+/g, ' ')}`);
}

/**
 * Every request is individually timed out, and that is load-bearing rather
 * than tidy. `fetch` has NO default timeout: a connection that opens and then
 * stalls never settles, so the poll loop below never gets to re-check its
 * deadline and the whole script hangs forever — in CI, until GitHub's job
 * limit hours later, which is indistinguishable from a deploy that is simply
 * slow. A deadline you can only reach by returning is not a deadline.
 */
const REQUEST_TIMEOUT_MS = 15_000;

async function get(url, accept = '*/*') {
  const res = await fetch(url, {
    headers: { accept, 'user-agent': 'bpm-smoke/1.0 (+read-only)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { res, text: await res.text() };
}

/* ────────────────────────────────────────────────────────────────────────────
 * TODO(Grant): this one is yours — it is a product judgement, not boilerplate.
 *
 * Everything else in this file asks a question with an objectively correct
 * answer (did it 200, is it JSON, does the SHA match). This one asks what YOU
 * mean by "the app is up", and only you can set that line.
 *
 * The trap it exists to close: Azure serves its own error and warm-up pages
 * with HTTP 200. A status check alone therefore passes while users see
 * nothing, which is the same shape as the v1.3 Cosmos incident — confidently
 * green, actually broken.
 *
 * The trade-off runs in both directions:
 *   - Too strict (asserting copy, a player's name, a specific announcement)
 *     and this goes red on an ordinary content change, teaching everyone to
 *     ignore it. A check people dismiss unread is worse than no check.
 *   - Too loose (`html.length > 0`, `includes('<html')`) and an Azure holding
 *     page sails through, which is exactly the failure we are buying this to
 *     catch.
 *
 * Something structural that only YOUR page emits is the sweet spot. Worth
 * considering: the pre-hydration splash in `app/layout.tsx`, the `bpm-topbar`
 * shell, `data-visual`/`data-theme` on `<html>`, the `bpm-build` meta tag, or
 * the server-rendered announcement. Note the layout renders even when the PAGE
 * throws (that is what `app/error.tsx` is for now) — so if you want this to
 * catch a broken Home rather than just a broken Next, reach for something
 * HomeShell emits, not something the layout does.
 *
 * @param {string} html  the full body of GET {BASE}
 * @returns {string|null}  null = healthy; a short reason = failed
 * ──────────────────────────────────────────────────────────────────────────── */
function assertAlive(html) {
  // PROVISIONAL — deliberately weak, so the check is honest about what it
  // currently proves (Next rendered our document, not Azure's) rather than
  // pretending to more. Replace with your own line.
  if (!html.includes('<meta name="bpm-build"')) return 'no bpm-build meta — not our document';
  return null;
}

/** Which build is answering? `null` when the tag is absent (pre-deploy builds). */
function servedSha(html) {
  const m = html.match(/<meta name="bpm-build" content="([^"]*)"/);
  return m ? m[1] : null;
}

/**
 * Block until the SHA we just deployed is the one being served.
 *
 * Without this the whole script is theatre: `azure/webapps-deploy` returns
 * before the swap and warm-up complete, so every check below can pass against
 * the PREVIOUS instance — green precisely because the last deploy was fine.
 */
async function waitForBuild() {
  const started = Date.now();
  let lastSeen = '(no response)';
  while (Date.now() - started < DEADLINE_MS) {
    try {
      const { res, text } = await get(BASE, 'text/html');
      if (res.ok) {
        const seen = servedSha(text);
        if (!WANT_SHA) return { ok: true, html: text };
        if (seen && seen === WANT_SHA) return { ok: true, html: text };
        lastSeen = seen ?? '(no bpm-build meta)';
      } else {
        lastSeen = `HTTP ${res.status}`;
      }
    } catch (err) {
      lastSeen = String(err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return { ok: false, lastSeen };
}

async function checkJson(url, label, predicate) {
  try {
    const { res, text } = await get(url, 'application/json');
    if (!res.ok) return fail(label, `HTTP ${res.status}`, text);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // A 200 that is not JSON is the shape an Azure error page takes when it
      // stands in for an API route.
      return fail(label, 'not valid JSON', text);
    }
    const why = predicate ? predicate(data) : null;
    return why ? fail(label, why, text) : pass(label);
  } catch (err) {
    return fail(label, String(err?.message ?? err));
  }
}

async function checkOk(url, label) {
  try {
    const { res, text } = await get(url);
    return res.ok ? pass(label) : fail(label, `HTTP ${res.status}`, text);
  } catch (err) {
    return fail(label, String(err?.message ?? err));
  }
}

async function main() {
  console.log(`==> smoke ${BASE}${WANT_SHA ? ` (waiting for ${WANT_SHA.slice(0, 7)})` : ''}`);

  const build = await waitForBuild();
  if (!build.ok) {
    fail('serving the expected build', `gave up after ${DEADLINE_MS / 1000}s; last saw ${build.lastSeen}`);
    return report();
  }
  pass(WANT_SHA ? `serving ${WANT_SHA.slice(0, 7)}` : 'responds');

  const why = assertAlive(build.html);
  if (why) fail('page renders', why, build.html);
  else pass('page renders');

  // The packaging burn, twice recorded: `next build --standalone` drops
  // .next/static AND public/, both copied in by hand in deploy-next.yml. A
  // miss there leaves a page that renders server-side and is dead in the
  // browser, so assert one real chunk and one real public/ asset.
  // Capture the WHOLE src, basePath included. Matching from `/_next/` alone
  // silently drops the `/bpm` prefix and 404s every time — the same basePath
  // trap that makes the app look offline in dev (CLAUDE.md).
  const chunk = build.html.match(/["'](\/[^"']*?\/_next\/static\/chunks\/[^"']+\.js)["']/);
  if (chunk) await checkOk(`${ORIGIN}${chunk[1]}`, 'static chunk loads (.next/static copied)');
  else fail('static chunk loads', 'no chunk URL found in the HTML');
  await checkOk(`${BASE}/sw.js`, 'sw.js served (public/ copied)');

  // Cosmos, honestly. `/api/session` CATCHES and returns DEFAULT_SESSION with
  // a 200, and an unset COSMOS_CONNECTION_STRING silently activates the mock
  // store in production — so "200 with a sessionId" is exactly what the
  // misconfigured-but-empty case looks like. `_rid` is written by real Cosmos
  // and never by the mock, which makes it the only honest discriminator. It is
  // also what this repo's own incident notes say to check first.
  await checkJson(
    `${BASE}/api/session`,
    MOCK ? 'session endpoint answers (mock store)' : 'session is real Cosmos data (_rid)',
    (d) => {
      if (!d || typeof d.sessionId !== 'string') return 'no sessionId in the response';
      if (MOCK) return null;
      return typeof d._rid === 'string' && d._rid.length > 0
        ? null
        : 'no _rid — mock store in production, or a swallowed Cosmos error';
    },
  );

  // Native-critical, and silently breakable by a next.config.js rewrite. NOTE:
  // these are served from App Settings env, not from the deployed bundle — a
  // red here is not necessarily a regression of the commit that triggered it.
  if (!SKIP_WELL_KNOWN) {
    await checkJson(`${ORIGIN}/.well-known/apple-app-site-association`, 'AASA (universal links)', (d) =>
      d && typeof d === 'object' ? null : 'not an object',
    );
    await checkJson(`${ORIGIN}/.well-known/assetlinks.json`, 'assetlinks (App Links)', (d) =>
      Array.isArray(d) && d.length > 0 ? null : 'not a non-empty array',
    );
  }

  return report();
}

function report() {
  console.log(`\n==> ${checks - failures.length}/${checks} checks passed`);
  if (failures.length) {
    console.error(`==> SMOKE FAILED: ${failures.map((f) => f.what).join(', ')}`);
    process.exit(1);
  }
  console.log('==> SMOKE OK');
}

main().catch((err) => {
  console.error('==> SMOKE CRASHED:', err);
  process.exit(1);
});
