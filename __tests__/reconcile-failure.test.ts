import { describe, it, expect } from 'vitest';
import { reconcileFailureFrom, reconcileFailureMessage } from '@/lib/reconcileFailure';

/**
 * #733: "Check now" used to say one thing for every failure. Each answer the
 * route gives now reads as itself, and every message carries its status code.
 */
describe('reconcileFailureMessage', () => {
  it('tells the route answers apart, each with its status', () => {
    const msgs = [
      reconcileFailureMessage(401, null),
      reconcileFailureMessage(403, null),
      reconcileFailureMessage(429, 'rate_limited'),
      reconcileFailureMessage(404, 'not_found'),
      reconcileFailureMessage(503, 'reconcile_failed'),
    ];
    expect(msgs[0]).toMatch(/sign in again.*\(401\)$/);
    expect(msgs[1]).toMatch(/\(403\)$/);
    expect(msgs[2]).toMatch(/wait a few minutes.*\(429\)$/);
    expect(msgs[3]).toMatch(/switched off.*\(404\)$/);
    expect(msgs[4]).toMatch(/server log.*\(503\)$/);
    expect(new Set([msgs[0], msgs[2], msgs[3], msgs[4]]).size).toBe(4);
  });

  it('a request that got no answer says so, with no made-up status', () => {
    expect(reconcileFailureMessage(null, null)).toMatch(/Couldn't reach the server/);
  });

  it('an answer it does not know still shows the status and the key', () => {
    expect(reconcileFailureMessage(500, null)).toBe("Couldn't run the check — try again. (500)");
    expect(reconcileFailureMessage(502, 'bad_gateway')).toBe("Couldn't run the check — try again. (502 bad_gateway)");
  });
});

describe('reconcileFailureFrom', () => {
  it('reads the error key from the body', async () => {
    const res = new Response(JSON.stringify({ error: 'reconcile_failed' }), { status: 503 });
    expect(await reconcileFailureFrom(res)).toMatch(/server log.*\(503\)$/);
  });

  it('a body that is not JSON (a proxy error page) still gives the status', async () => {
    expect(await reconcileFailureFrom(new Response('<html>Bad Gateway</html>', { status: 502 }))).toBe(
      "Couldn't run the check — try again. (502)",
    );
  });
});
