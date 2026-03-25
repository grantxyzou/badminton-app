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

export function getClientIp(req: Request): string {
  const headers = req.headers as Headers;
  // Azure App Service sets X-Client-IP to the real client IP — use it first
  const clientIp = headers.get('x-client-ip');
  if (clientIp) return clientIp;
  // X-Forwarded-For format on Azure: "clientIP, proxyIP" — first entry is the real client
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return 'unknown';
}
