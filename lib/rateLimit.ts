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
 * Get the real client IP from Azure App Service headers.
 *
 * ASSUMPTION: This app runs behind Azure App Service's load balancer, which
 * sets X-Client-IP to the actual client IP and strips it from external requests.
 * If deployed outside Azure (e.g., local tunnel, other cloud), these headers
 * are user-controlled and rate limiting can be bypassed by spoofing them.
 */
export function getClientIp(req: Request): string {
  const headers = req.headers as Headers;
  const clientIp = headers.get('x-client-ip');
  if (clientIp) return clientIp;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return 'unknown';
}
