interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

/** Returns true if the request is allowed, false if rate-limited. */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}

export function getClientIp(req: Request): string | null {
  const forwarded = (req.headers as Headers).get('x-forwarded-for');
  if (forwarded) {
    // Use the last IP — added by the trusted edge proxy, not spoofable by clients
    const ips = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    if (ips.length > 0) return ips[ips.length - 1];
  }
  // In production (behind Azure Front Door) every request has x-forwarded-for.
  // A missing header in production indicates a suspicious direct request.
  if (process.env.NODE_ENV === 'production') return null;
  return 'unknown';
}
