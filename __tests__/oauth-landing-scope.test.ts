import { describe, it, expect, vi } from 'vitest';
import { oauthFailure } from '../lib/oauthCallback';

/**
 * Every provider redirect must land INSIDE the app's own manifest scope.
 *
 * This is the invariant a missing trailing slash broke. `landing()` returned
 * `/bpm?…` while the manifest declared `scope: "/bpm/"`, and manifest scope is
 * a path-PREFIX match — so `/bpm` is outside `/bpm/`.
 *
 * On an installed iOS PWA that made sign-in unusable rather than merely untidy:
 * iOS resolves the redirect chain, sees it end out of scope, and keeps the
 * whole excursion in the in-app Safari view instead of returning to the PWA.
 * The callback is then issued by a browser whose cookie container never saw the
 * state cookie `/start` wrote inside the PWA — a deterministic
 * `state_mismatch`, and the user stranded in Safari afterwards. One character.
 *
 * WHY THIS TEST SHAPE. Nothing here can perform a cross-origin redirect or
 * model how iOS applies scope, so no behavioural test could have caught it.
 * What CAN be checked is that the two halves agree: the URL this app sends
 * people to, against the scope this app publishes. Reading the scope from the
 * manifest rather than hard-coding it is the point — change either side alone
 * and this fails, which is exactly when someone needs to be told.
 *
 * The two sides derive the base path DIFFERENTLY on purpose. `manifest()` reads
 * NEXT_PUBLIC_BASE_PATH; `landing()` hardcodes `/bpm`, because a server-side
 * redirect that silently loses its prefix when a NEXT_PUBLIC_ var goes missing
 * is precisely the failure CLAUDE.md warns about. That divergence is also why
 * the manifest is loaded through `vi.resetModules()` below: it captures the env
 * var at MODULE scope, so setting the variable in a hook would be too late and
 * the comparison would run between two different worlds, proving nothing.
 */
const ORIGIN = 'https://bpm.grantzou.com';

async function scopeUnderProdBasePath(): Promise<string> {
  const before = process.env.NEXT_PUBLIC_BASE_PATH;
  process.env.NEXT_PUBLIC_BASE_PATH = '/bpm';
  vi.resetModules();
  try {
    const mod = await import('../app/manifest');
    const scope = mod.default().scope;
    if (typeof scope !== 'string') throw new Error('manifest declares no scope');
    return scope;
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = before;
    vi.resetModules();
  }
}

function landingUrlFrom(res: Response): URL {
  const loc = res.headers.get('location');
  if (!loc) throw new Error('redirect carried no Location header');
  return new URL(loc);
}

describe('provider redirects land inside the manifest scope', () => {
  it('the manifest declares a trailing-slash scope to check against', async () => {
    // Guards the guard. Were scope ever undefined or slashless, the prefix
    // assertions below would pass vacuously and prove nothing.
    await expect(scopeUnderProdBasePath()).resolves.toBe('/bpm/');
  });

  it('a failure redirect stays in scope', async () => {
    const scope = await scopeUnderProdBasePath();
    const url = landingUrlFrom(oauthFailure(ORIGIN, 'state_mismatch'));
    expect(url.pathname.startsWith(scope)).toBe(true);
  });

  it('carries the reason through, so the landing page can still explain itself', () => {
    const url = landingUrlFrom(oauthFailure(ORIGIN, 'state_mismatch'));
    expect(url.searchParams.get('authError')).toBe('state_mismatch');
  });

  it('rejects the exact shape that broke iOS — the scope prefix without its slash', async () => {
    const scope = await scopeUnderProdBasePath();
    // `/bpm` looks right and passes a naive startsWith('/bpm'). It fails the
    // rule iOS actually applies, which is what this pins.
    expect('/bpm'.startsWith(scope)).toBe(false);
    expect('/bpm/'.startsWith(scope)).toBe(true);
  });

  it('uses 303, so an Apple form_post callback does not re-POST the landing page', () => {
    expect(oauthFailure(ORIGIN, 'cancelled').status).toBe(303);
  });
});
