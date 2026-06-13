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
 * ASSUMPTION: This app runs behind Azure App Service's load balancer, which
 * sets `X-Client-IP` to the actual client IP and strips any client-supplied
 * value. Under that assumption these headers are trustworthy.
 *
 * RISK: if deployed behind a *different* proxy (or none — local tunnel, other
 * cloud), `X-Client-IP`/`X-Forwarded-For` become fully client-controlled, so an
 * attacker can rotate them to bypass per-IP rate limits (e.g. brute-forcing the
 * recovery-code / PIN endpoints). To harden such a deployment, set
 * `TRUSTED_IP_HEADER` to the single header your proxy guarantees (e.g.
 * `cf-connecting-ip` behind Cloudflare). When set, ONLY that header is trusted
 * and the spoofable `X-Forwarded-For` fallback is skipped. Left unset, behaviour
 * is unchanged (Azure-compatible).
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

  const clientIp = headers.get('x-client-ip');
  if (clientIp) return clientIp;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return 'unknown';
}
