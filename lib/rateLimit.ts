interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

/** Returns true if the request is allowed, false if rate-limited. */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();

  // Prune stale entries if store grows large to prevent unbounded memory growth
  if (store.size > 500) {
    store.forEach((e, k) => {
      if (now > e.resetAt) store.delete(k);
    });
  }

  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

/**
 * Get the real client IP from the trusted proxy header.
 *
 * This app runs behind Azure App Service's load balancer, which OVERWRITES
 * `X-Forwarded-For` with the address it saw on the socket. A value the caller
 * supplies is discarded, so the first entry is the real client and is the one
 * to key a rate limit on. Do NOT switch to the last entry: nothing appends
 * here, so there is no proxy hop at the end to skip.
 *
 * **`X-Client-IP` IS NOT READ, AND MUST NOT BE ADDED BACK.** It used to be
 * consulted FIRST, on a comment asserting Azure "sets `X-Client-IP` to the
 * actual client IP and strips any client-supplied value". That was false in
 * both halves. Azure sets no such header — its own vocabulary is
 * `X-Forwarded-For` / `X-Forwarded-Host` / `X-Azure-*` — and because Azure does
 * not set it, it does not strip it either: the caller's value arrived intact
 * and this function trusted it ahead of the real one. Measured against
 * production on 2026-09-12, one changed byte of that header bought a fresh
 * allowance on every per-IP limit in the app, the sign-in throttle and the
 * PIN-verification limiters included. The only writer of `X-Client-IP` in this
 * repository is the test suite, which uses it to give each test its own bucket
 * — a test fixture that production was trusting as a credential.
 *
 * The same measurement was read as clearing `X-Forwarded-For`: 121 requests
 * forging it all landed in ONE bucket, and a second forged value came back
 * already throttled. **That evidence does not reach that conclusion**, and the
 * wording is kept here as a caution. Run over a single keep-alive connection it
 * cannot separate "Azure overwrites the header" from "the key varies per
 * connection" — and on 2026-09-13 the second turned out to be true as well (see
 * `stripPort`). Azure does overwrite the header; the probe just never showed it.
 *
 * `TRUSTED_IP_HEADER` names the single header to trust instead, for a
 * deployment behind a different proxy (`cf-connecting-ip` behind Cloudflare) —
 * and it is how the test suite re-enables `X-Client-IP` for itself, set in
 * `vitest.config.ts`. When set, ONLY that header is read.
 *
 * RISK that remains: behind no proxy at all (a local tunnel, a different
 * cloud), `X-Forwarded-For` is client-controlled again and per-IP limits are
 * bypassable by rotating it. Set `TRUSTED_IP_HEADER` on any such deployment.
 */
/**
 * Strip a `:port` suffix from a forwarded address.
 *
 * **Azure App Service writes `X-Forwarded-For: <client-ip>:<source-port>`**, and
 * the source port changes with every TCP connection. Keying a limit on the raw
 * entry therefore hands every new connection a FRESH bucket, which defeats the
 * limit for anyone willing to reconnect — measured against production on
 * 2026-09-13, four separate connections each got their own clean 30 of a 30/min
 * limit, while forty requests sharing one connection throttled at exactly 30.
 *
 * This is OLDER than the `X-Client-IP` removal, not caused by it: no browser
 * ever sent `X-Client-IP`, so real traffic always fell through to this path.
 * Removing the forgeable header is simply what left it as the only one.
 *
 * The long-window gates are where it bit. Within a page session a browser
 * multiplexes over one HTTP/2 connection, so the per-minute limits were roughly
 * enforced; connections turn over well inside an hour, so `auth-signin` (5/hr),
 * `admin` (5/15min), `auth-signup` (5/hr) and `reset-access` (10/hr) — the
 * brute-force gates — were resettable by reconnecting.
 *
 * IPv6 is why this is not a `split(':')`: a bare `2001:db8::1` is all colons and
 * no port. Only a bracketed form or a single trailing `:digits` is a port.
 */
function stripPort(raw: string): string {
  const value = raw.trim();

  // `[::1]` or `[::1]:443` — the bracketed form exists precisely to make the
  // port unambiguous, so the brackets come off with it.
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) return bracketed[1];

  // Exactly one colon followed by digits is `host:port`. Two or more colons is
  // a bare IPv6 address and must be left whole.
  const colon = value.indexOf(':');
  if (
    colon > 0 &&
    value.indexOf(':', colon + 1) === -1 &&
    /^\d{1,5}$/.test(value.slice(colon + 1))
  ) {
    return value.slice(0, colon);
  }

  return value;
}

export function getClientIp(req: Request): string {
  const headers = req.headers as Headers;

  const trustedHeader = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (trustedHeader) {
    const value = headers.get(trustedHeader);
    if (value) {
      const first = stripPort(value.split(',')[0].trim());
      if (first) return first;
    }
    return 'unknown';
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = stripPort(forwarded.split(',')[0].trim());
    if (first) return first;
  }
  return 'unknown';
}
