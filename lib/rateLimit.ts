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
 * The same measurement cleared `X-Forwarded-For`: 121 requests forging it all
 * landed in ONE bucket, and a second forged value came back already throttled,
 * which is Azure overwriting it. That is why the fallback is now the only path.
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
export function getClientIp(req: Request): string {
  const headers = req.headers as Headers;

  const trustedHeader = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (trustedHeader) {
    const value = headers.get(trustedHeader);
    if (value) {
      const first = value.split(',')[0].trim();
      if (first) return first;
    }
    return 'unknown';
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return 'unknown';
}
